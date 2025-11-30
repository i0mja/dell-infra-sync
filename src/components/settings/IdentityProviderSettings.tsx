import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { useIdmSettings } from '@/hooks/useIdmSettings';
import { useIdmGroupMappings } from '@/hooks/useIdmGroupMappings';
import { useBreakGlassAdmins } from '@/hooks/useBreakGlassAdmins';
import { IdmSessionManager } from './IdmSessionManager';
import { AlertCircle, CheckCircle2, Loader2, Plus, RefreshCw, Save, ShieldAlert, TestTube, Trash2 } from 'lucide-react';

export function IdentityProviderSettings() {
  const { settings, loading, saving, saveSettings, testConnection, triggerSync } = useIdmSettings();
  const { mappings, createMapping, updateMapping, deleteMapping } = useIdmGroupMappings();
  const { admins, createAdmin, activateAdmin, deactivateAdmin, deleteAdmin } = useBreakGlassAdmins();

  // Form states
  const [authMode, setAuthMode] = useState(settings?.auth_mode || 'local_only');
  const [serverHost, setServerHost] = useState(settings?.server_host || '');
  const [serverPort, setServerPort] = useState(settings?.server_port || 389);
  const [ldapsPort, setLdapsPort] = useState(settings?.ldaps_port || 636);
  const [useLdaps, setUseLdaps] = useState(settings?.use_ldaps ?? true);
  const [verifyCertificate, setVerifyCertificate] = useState(settings?.verify_certificate ?? true);
  const [baseDn, setBaseDn] = useState(settings?.base_dn || '');
  const [userSearchBase, setUserSearchBase] = useState(settings?.user_search_base || 'cn=users,cn=accounts');
  const [groupSearchBase, setGroupSearchBase] = useState(settings?.group_search_base || 'cn=groups,cn=accounts');
  const [bindDn, setBindDn] = useState(settings?.bind_dn || '');
  const [bindPassword, setBindPassword] = useState('');
  const [caCertificate, setCaCertificate] = useState(settings?.ca_certificate || '');
  const [connectionTimeout, setConnectionTimeout] = useState(settings?.connection_timeout_seconds || 10);
  const [maxFailedAttempts, setMaxFailedAttempts] = useState(settings?.max_failed_attempts || 5);
  const [lockoutDuration, setLockoutDuration] = useState(settings?.lockout_duration_minutes || 30);
  const [sessionTimeout, setSessionTimeout] = useState(settings?.session_timeout_minutes || 480);
  const [failoverBehavior, setFailoverBehavior] = useState(settings?.failover_behavior || 'block_login');
  const [syncEnabled, setSyncEnabled] = useState(settings?.sync_enabled ?? false);
  const [syncInterval, setSyncInterval] = useState(settings?.sync_interval_minutes || 60);

  // Dialog states
  const [showMappingDialog, setShowMappingDialog] = useState(false);
  const [showAdminDialog, setShowAdminDialog] = useState(false);
  const [showActivateDialog, setShowActivateDialog] = useState(false);
  const [selectedAdmin, setSelectedAdmin] = useState<any>(null);
  const [activationReason, setActivationReason] = useState('');

  // Mapping form
  const [mappingForm, setMappingForm] = useState({
    idm_group_dn: '',
    idm_group_name: '',
    app_role: 'viewer' as 'admin' | 'operator' | 'viewer',
    priority: 100,
    is_active: true,
    description: '',
  });

  // Admin form
  const [adminForm, setAdminForm] = useState({
    email: '',
    full_name: '',
    password: '',
  });

  const handleSaveSettings = async () => {
    const updates: any = {
      auth_mode: authMode,
      server_host: serverHost,
      server_port: serverPort,
      ldaps_port: ldapsPort,
      use_ldaps: useLdaps,
      verify_certificate: verifyCertificate,
      base_dn: baseDn,
      user_search_base: userSearchBase,
      group_search_base: groupSearchBase,
      bind_dn: bindDn,
      ca_certificate: caCertificate,
      connection_timeout_seconds: connectionTimeout,
      max_failed_attempts: maxFailedAttempts,
      lockout_duration_minutes: lockoutDuration,
      session_timeout_minutes: sessionTimeout,
      failover_behavior: failoverBehavior,
      sync_enabled: syncEnabled,
      sync_interval_minutes: syncInterval,
    };

    if (bindPassword) {
      updates.bind_password_encrypted = bindPassword;
    }

    await saveSettings(updates);
    setBindPassword(''); // Clear password field after save
  };

  const handleCreateMapping = async () => {
    await createMapping(mappingForm);
    setMappingForm({
      idm_group_dn: '',
      idm_group_name: '',
      app_role: 'viewer',
      priority: 100,
      is_active: true,
      description: '',
    });
    setShowMappingDialog(false);
  };

  const handleCreateAdmin = async () => {
    await createAdmin(adminForm);
    setAdminForm({ email: '', full_name: '', password: '' });
    setShowAdminDialog(false);
  };

  const handleActivateAdmin = async () => {
    if (selectedAdmin && activationReason) {
      await activateAdmin(selectedAdmin.id, activationReason);
      setShowActivateDialog(false);
      setActivationReason('');
      setSelectedAdmin(null);
    }
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
              {authMode === 'local_only' && 'Only local Supabase authentication is used'}
              {authMode === 'idm_primary' && 'FreeIPA authentication is primary, local accounts as backup'}
              {authMode === 'idm_fallback' && 'Local authentication is primary, FreeIPA as backup'}
            </p>
          </div>

          {authMode !== 'local_only' && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                IDM authentication is enabled. Make sure FreeIPA connection is properly configured below.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* FreeIPA Connection */}
      {authMode !== 'local_only' && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>FreeIPA Connection</CardTitle>
              <CardDescription>Configure connection to your FreeIPA/LDAP server</CardDescription>
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

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>LDAP Port</Label>
                  <Input
                    type="number"
                    value={serverPort}
                    onChange={(e) => setServerPort(parseInt(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>LDAPS Port</Label>
                  <Input
                    type="number"
                    value={ldapsPort}
                    onChange={(e) => setLdapsPort(parseInt(e.target.value))}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Use LDAPS (Recommended)</Label>
                  <p className="text-sm text-muted-foreground">Encrypt connection with TLS</p>
                </div>
                <Switch checked={useLdaps} onCheckedChange={setUseLdaps} />
              </div>

              {useLdaps && (
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Verify Certificate</Label>
                    <p className="text-sm text-muted-foreground">Validate server SSL certificate</p>
                  </div>
                  <Switch checked={verifyCertificate} onCheckedChange={setVerifyCertificate} />
                </div>
              )}

              <Button onClick={testConnection} variant="outline">
                <TestTube className="mr-2 h-4 w-4" />
                Test Connection
              </Button>
            </CardContent>
          </Card>

          {/* LDAP Structure */}
          <Card>
            <CardHeader>
              <CardTitle>LDAP Structure</CardTitle>
              <CardDescription>Define the LDAP directory structure</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Base DN</Label>
                <Input
                  placeholder="dc=example,dc=com"
                  value={baseDn}
                  onChange={(e) => setBaseDn(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>User Search Base</Label>
                <Input
                  placeholder="cn=users,cn=accounts"
                  value={userSearchBase}
                  onChange={(e) => setUserSearchBase(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Group Search Base</Label>
                <Input
                  placeholder="cn=groups,cn=accounts"
                  value={groupSearchBase}
                  onChange={(e) => setGroupSearchBase(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Service Account */}
          <Card>
            <CardHeader>
              <CardTitle>Service Account</CardTitle>
              <CardDescription>Credentials for binding to LDAP directory</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Bind DN</Label>
                <Input
                  placeholder="uid=svc_dsm,cn=users,cn=accounts,dc=example,dc=com"
                  value={bindDn}
                  onChange={(e) => setBindDn(e.target.value)}
                />
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
          {useLdaps && verifyCertificate && (
            <Card>
              <CardHeader>
                <CardTitle>CA Certificate</CardTitle>
                <CardDescription>PEM-formatted certificate authority certificate</CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  placeholder="-----BEGIN CERTIFICATE-----&#10;..."
                  value={caCertificate}
                  onChange={(e) => setCaCertificate(e.target.value)}
                  rows={8}
                  className="font-mono text-sm"
                />
              </CardContent>
            </Card>
          )}

          {/* Group Mappings */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Group-to-Role Mappings</CardTitle>
                  <CardDescription>Map FreeIPA groups to application roles</CardDescription>
                </div>
                <Dialog open={showMappingDialog} onOpenChange={setShowMappingDialog}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="mr-2 h-4 w-4" />
                      Add Mapping
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Create Group Mapping</DialogTitle>
                      <DialogDescription>Map a FreeIPA group to an application role</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Group DN</Label>
                        <Input
                          placeholder="cn=admins,cn=groups,cn=accounts,dc=example,dc=com"
                          value={mappingForm.idm_group_dn}
                          onChange={(e) => setMappingForm({ ...mappingForm, idm_group_dn: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Group Name</Label>
                        <Input
                          placeholder="admins"
                          value={mappingForm.idm_group_name}
                          onChange={(e) => setMappingForm({ ...mappingForm, idm_group_name: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>App Role</Label>
                        <Select
                          value={mappingForm.app_role}
                          onValueChange={(value: any) => setMappingForm({ ...mappingForm, app_role: value })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="operator">Operator</SelectItem>
                            <SelectItem value="viewer">Viewer</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Priority</Label>
                        <Input
                          type="number"
                          value={mappingForm.priority}
                          onChange={(e) => setMappingForm({ ...mappingForm, priority: parseInt(e.target.value) })}
                        />
                        <p className="text-sm text-muted-foreground">Higher priority = evaluated first</p>
                      </div>
                      <div className="space-y-2">
                        <Label>Description</Label>
                        <Input
                          value={mappingForm.description}
                          onChange={(e) => setMappingForm({ ...mappingForm, description: e.target.value })}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button onClick={handleCreateMapping}>Create Mapping</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Group Name</TableHead>
                    <TableHead>App Role</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappings.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        No group mappings configured
                      </TableCell>
                    </TableRow>
                  ) : (
                    mappings.map((mapping) => (
                      <TableRow key={mapping.id}>
                        <TableCell className="font-medium">{mapping.idm_group_name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{mapping.app_role}</Badge>
                        </TableCell>
                        <TableCell>{mapping.priority}</TableCell>
                        <TableCell>
                          {mapping.is_active ? (
                            <Badge variant="default">Active</Badge>
                          ) : (
                            <Badge variant="secondary">Inactive</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => updateMapping(mapping.id, { is_active: !mapping.is_active })}
                          >
                            {mapping.is_active ? 'Disable' : 'Enable'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deleteMapping(mapping.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Security Policies */}
          <Card>
            <CardHeader>
              <CardTitle>Security Policies</CardTitle>
              <CardDescription>Configure rate limiting and session management</CardDescription>
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
                </div>
                <div className="space-y-2">
                  <Label>Lockout Duration (minutes)</Label>
                  <Input
                    type="number"
                    value={lockoutDuration}
                    onChange={(e) => setLockoutDuration(parseInt(e.target.value))}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Session Timeout (minutes)</Label>
                <Input
                  type="number"
                  value={sessionTimeout}
                  onChange={(e) => setSessionTimeout(parseInt(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label>Failover Behavior (when IDM unavailable)</Label>
                <Select value={failoverBehavior} onValueChange={setFailoverBehavior}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="block_login">Block Login</SelectItem>
                    <SelectItem value="allow_local">Allow Local Auth</SelectItem>
                  </SelectContent>
                </Select>
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
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Enable User Sync</Label>
                  <p className="text-sm text-muted-foreground">Periodically sync user information</p>
                </div>
                <Switch checked={syncEnabled} onCheckedChange={setSyncEnabled} />
              </div>
              {syncEnabled && (
                <>
                  <div className="space-y-2">
                    <Label>Sync Interval (minutes)</Label>
                    <Input
                      type="number"
                      value={syncInterval}
                      onChange={(e) => setSyncInterval(parseInt(e.target.value))}
                    />
                  </div>
                  {settings?.last_sync_at && (
                    <div className="rounded-md bg-muted p-3">
                      <div className="flex items-center gap-2">
                        {settings.last_sync_status === 'success' ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-destructive" />
                        )}
                        <span className="text-sm">
                          Last sync: {new Date(settings.last_sync_at).toLocaleString()}
                        </span>
                      </div>
                      {settings.last_sync_error && (
                        <p className="mt-2 text-sm text-destructive">{settings.last_sync_error}</p>
                      )}
                    </div>
                  )}
                  <Button onClick={triggerSync} variant="outline">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Sync Now
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {/* Break-Glass Administrators */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldAlert className="h-5 w-5" />
                    Break-Glass Administrators
                  </CardTitle>
                  <CardDescription>Emergency local admin accounts that bypass IDM</CardDescription>
                </div>
                <Dialog open={showAdminDialog} onOpenChange={setShowAdminDialog}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline">
                      <Plus className="mr-2 h-4 w-4" />
                      Add Admin
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Create Break-Glass Administrator</DialogTitle>
                      <DialogDescription>Create an emergency local admin account</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Email</Label>
                        <Input
                          type="email"
                          value={adminForm.email}
                          onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Full Name</Label>
                        <Input
                          value={adminForm.full_name}
                          onChange={(e) => setAdminForm({ ...adminForm, full_name: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Password</Label>
                        <Input
                          type="password"
                          value={adminForm.password}
                          onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })}
                        />
                      </div>
                      <Alert>
                        <ShieldAlert className="h-4 w-4" />
                        <AlertDescription>
                          This account will bypass IDM authentication and should only be used in emergencies.
                        </AlertDescription>
                      </Alert>
                    </div>
                    <DialogFooter>
                      <Button onClick={handleCreateAdmin}>Create Admin</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Use Count</TableHead>
                    <TableHead>Last Used</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {admins.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        No break-glass administrators configured
                      </TableCell>
                    </TableRow>
                  ) : (
                    admins.map((admin) => (
                      <TableRow key={admin.id}>
                        <TableCell className="font-medium">{admin.email}</TableCell>
                        <TableCell>{admin.full_name}</TableCell>
                        <TableCell>
                          {admin.is_active ? (
                            <Badge variant="destructive">Active</Badge>
                          ) : (
                            <Badge variant="secondary">Inactive</Badge>
                          )}
                        </TableCell>
                        <TableCell>{admin.use_count || 0}</TableCell>
                        <TableCell>
                          {admin.last_used_at ? new Date(admin.last_used_at).toLocaleDateString() : 'Never'}
                        </TableCell>
                        <TableCell>
                          {admin.is_active ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => deactivateAdmin(admin.id)}
                            >
                              Deactivate
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedAdmin(admin);
                                setShowActivateDialog(true);
                              }}
                            >
                              Activate
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deleteAdmin(admin.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Activation Reason Dialog */}
          <Dialog open={showActivateDialog} onOpenChange={setShowActivateDialog}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Activate Break-Glass Administrator</DialogTitle>
                <DialogDescription>Provide a reason for activating this emergency account</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Activation Reason</Label>
                  <Textarea
                    placeholder="Describe why this emergency account needs to be activated..."
                    value={activationReason}
                    onChange={(e) => setActivationReason(e.target.value)}
                    rows={4}
                  />
                </div>
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    This action will be logged in the audit trail for security compliance.
                  </AlertDescription>
                </Alert>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowActivateDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={handleActivateAdmin} disabled={!activationReason}>
                  Activate Admin
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={handleSaveSettings} disabled={saving}>
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

      {/* Active IDM Sessions Section */}
      {authMode !== 'local_only' && (
        <>
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
        </>
      )}
    </div>
  );
}
