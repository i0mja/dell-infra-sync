import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useIdmSettings } from '@/hooks/useIdmSettings';
import { AlertCircle, Loader2, Save, TestTube, Lock, Unlock, CheckCircle, XCircle, Plus, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

// Helper functions for auto-derivation
// Convert full hostname directly to Base DN (idm.neopost.grp → dc=idm,dc=neopost,dc=grp)
function hostToBaseDn(host: string): string {
  return host.split('.').map(part => `dc=${part}`).join(',');
}

function usernameToBindDn(username: string, baseDn: string): string {
  // Handle user@domain or just username
  const user = username.includes('@') ? username.split('@')[0] : username;
  return `uid=${user},cn=users,cn=accounts,${baseDn}`;
}

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
  const [manualBaseDn, setManualBaseDn] = useState(false);
  const [serviceUsername, setServiceUsername] = useState('');
  const [bindDn, setBindDn] = useState(settings?.bind_dn || '');
  const [bindPassword, setBindPassword] = useState('');
  
  // Test connection state
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testJobId, setTestJobId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<any>(null);
  
  // Test authentication state
  const [testAuthUsername, setTestAuthUsername] = useState('');
  const [testAuthPassword, setTestAuthPassword] = useState('');
  const [testAuthStatus, setTestAuthStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testAuthResult, setTestAuthResult] = useState<any>(null);
  
  // AD Trust domains
  const [trustedDomains, setTrustedDomains] = useState<string[]>([]);
  const [newTrustedDomain, setNewTrustedDomain] = useState('');

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
      setTrustedDomains(settings.trusted_domains || []);
      
      // If there's a saved bind_dn, extract username for display
      if (settings.bind_dn) {
        const uidMatch = settings.bind_dn.match(/uid=([^,]+)/);
        if (uidMatch) {
          setServiceUsername(uidMatch[1]);
        }
      }
      
      // If base_dn is saved but doesn't match auto-derived, set manual mode
      if (settings.base_dn && settings.server_host) {
        const autoBaseDn = hostToBaseDn(settings.server_host);
        setManualBaseDn(settings.base_dn !== autoBaseDn);
      }
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
      trusted_domains: trustedDomains,
    };

    if (bindPassword) {
      updates.bind_password_encrypted = bindPassword;
    }

    await saveSettings(updates);
    setBindPassword('');
  };

  const handleAddTrustedDomain = () => {
    const domain = newTrustedDomain.trim().toLowerCase();
    if (domain && !trustedDomains.includes(domain)) {
      setTrustedDomains([...trustedDomains, domain]);
      setNewTrustedDomain('');
    }
  };

  const handleRemoveTrustedDomain = (domain: string) => {
    setTrustedDomains(trustedDomains.filter(d => d !== domain));
  };

  const handleServerHostChange = (host: string) => {
    setServerHost(host);
    
    // Auto-derive Base DN if not manually set and host contains domain
    if (!manualBaseDn && host.includes('.')) {
      const autoBaseDn = hostToBaseDn(host);
      setBaseDn(autoBaseDn);
      
      // Update bind DN if username exists
      if (serviceUsername) {
        setBindDn(usernameToBindDn(serviceUsername, autoBaseDn));
      }
    }
  };

  const handleUsernameChange = (input: string) => {
    setServiceUsername(input);
    
    // Auto-expand to full Bind DN if base DN exists
    if (baseDn) {
      setBindDn(usernameToBindDn(input, baseDn));
    }
  };

  const toggleManualBaseDn = () => {
    const newManualMode = !manualBaseDn;
    setManualBaseDn(newManualMode);
    
    // If switching to auto mode, re-derive from host
    if (!newManualMode && serverHost.includes('.')) {
      const autoBaseDn = hostToBaseDn(serverHost);
      setBaseDn(autoBaseDn);
      
      // Update bind DN if username exists
      if (serviceUsername) {
        setBindDn(usernameToBindDn(serviceUsername, autoBaseDn));
      }
    }
  };

  const handleTestConnection = async () => {
    setTestStatus('testing');
    setTestResult(null);
    
    const job = await testConnection({
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
    
    if (job?.id) {
      setTestJobId(job.id);
      pollJobStatus(job.id);
    }
  };
  
  const pollJobStatus = async (jobId: string) => {
    const maxAttempts = 30; // 30 seconds max (30 attempts * 1 second)
    let attempts = 0;
    
    const poll = async () => {
      attempts++;
      
      const { data: job } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', jobId)
        .single();
      
      if (!job) return;
      
      if (job.status === 'completed' || job.status === 'failed') {
        const details = job.details as any;
        const testResult = details?.test_result || details; // Handle both structures
        setTestResult(testResult);
        setTestStatus(job.status === 'completed' && testResult?.success ? 'success' : 'error');
        return;
      }
      
      if (attempts < maxAttempts && (job.status === 'pending' || job.status === 'running')) {
        setTimeout(poll, 1000);
      } else {
        setTestStatus('error');
        setTestResult({ error: 'Test timed out' });
      }
    };
    
    poll();
  };

  const handleTestAuth = async () => {
    if (!testAuthUsername || !testAuthPassword) return;
    
    setTestAuthStatus('testing');
    setTestAuthResult(null);
    
    const { data: job, error } = await supabase
      .from('jobs')
      .insert({
        job_type: 'idm_test_auth',
        status: 'pending',
        details: {
          username: testAuthUsername,
          password: testAuthPassword,
        },
        created_by: (await supabase.auth.getUser()).data.user?.id || '',
      })
      .select()
      .single();
    
    if (error || !job) {
      setTestAuthStatus('error');
      setTestAuthResult({ error: 'Failed to create test job' });
      return;
    }
    
    pollTestAuthStatus(job.id);
  };
  
  const pollTestAuthStatus = async (jobId: string) => {
    const maxAttempts = 30;
    let attempts = 0;
    
    const poll = async () => {
      attempts++;
      
      const { data: job } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', jobId)
        .single();
      
      if (!job) return;
      
      if (job.status === 'completed' || job.status === 'failed') {
        const details = job.details as any;
        const result = details?.test_result || {};
        setTestAuthResult(result);
        setTestAuthStatus(result.success ? 'success' : 'error');
        return;
      }
      
      if (attempts < maxAttempts && (job.status === 'pending' || job.status === 'running')) {
        setTimeout(poll, 1000);
      } else {
        setTestAuthStatus('error');
        setTestAuthResult({ error: 'Test timed out' });
      }
    };
    
    poll();
  };

  const canTestConnection = serverHost && bindDn && (bindPassword || settings?.bind_password_encrypted) && baseDn;
  const canTestAuth = testAuthUsername && testAuthPassword && authMode !== 'local_only';

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
                    placeholder="idm.example.com"
                    value={serverHost}
                    onChange={(e) => handleServerHostChange(e.target.value)}
                  />
                  {serverHost && (
                    <p className="text-sm text-muted-foreground">
                      Base DN will be: <span className="font-mono text-xs">{hostToBaseDn(serverHost)}</span>
                    </p>
                  )}
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
                <div className="flex items-center justify-between">
                  <Label>Base DN</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={toggleManualBaseDn}
                    className="h-8 px-2"
                  >
                    {manualBaseDn ? (
                      <>
                        <Unlock className="mr-1 h-3 w-3" />
                        Manual
                      </>
                    ) : (
                      <>
                        <Lock className="mr-1 h-3 w-3" />
                        Auto
                      </>
                    )}
                  </Button>
                </div>
                <Input
                  placeholder="dc=example,dc=com"
                  value={baseDn}
                  onChange={(e) => {
                    setBaseDn(e.target.value);
                    setManualBaseDn(true);
                  }}
                />
                <p className="text-sm text-muted-foreground">
                  {manualBaseDn ? (
                    <span className="text-amber-600">✏️ Manually configured</span>
                  ) : (
                    <span className="text-green-600">✓ Auto-derived from server host</span>
                  )}
                </p>
              </div>
              
              <div className="space-y-2">
                <Label>Service Account Username</Label>
                <Input
                  placeholder="svc_dsm or svc_dsm@idm.example.com"
                  value={serviceUsername}
                  onChange={(e) => handleUsernameChange(e.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  Enter username, username@domain, or full Bind DN
                </p>
              </div>
              
              {bindDn && (
                <div className="space-y-2 p-3 bg-muted/50 rounded-lg border">
                  <Label className="text-xs text-muted-foreground">Resolved Bind DN</Label>
                  <p className="text-sm font-mono break-all">{bindDn}</p>
                </div>
              )}
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

              <div className="space-y-3">
                <Button 
                  onClick={handleTestConnection} 
                  variant="outline"
                  disabled={!canTestConnection || testStatus === 'testing'}
                >
                  {testStatus === 'testing' ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Testing...
                    </>
                  ) : (
                    <>
                      <TestTube className="mr-2 h-4 w-4" />
                      Test Connection
                    </>
                  )}
                </Button>
                
                {testStatus === 'testing' && (
                  <Alert>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <AlertDescription>Testing connection to {serverHost}...</AlertDescription>
                  </Alert>
                )}
                
                {testStatus === 'success' && testResult && (
                  <Alert className="border-green-500 bg-green-50 dark:bg-green-950/20">
                    <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                    <AlertDescription className="text-green-800 dark:text-green-200">
                      <p className="font-medium">✅ Connection successful!</p>
                      {testResult.bind_successful && (
                        <p className="text-sm mt-1">
                          Authenticated as: <span className="font-mono">{testResult.bind_dn}</span>
                        </p>
                      )}
                      {testResult.response_time_ms && (
                        <p className="text-sm">Response time: {testResult.response_time_ms}ms</p>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
                
                {testStatus === 'error' && (
                  <Alert variant="destructive">
                    <XCircle className="h-4 w-4" />
                    <AlertDescription>
                      <p className="font-medium">❌ Connection failed</p>
                      {testResult?.error_type && (
                        <p className="text-sm mt-1">{testResult.error_type}</p>
                      )}
                      {testResult?.message && (
                        <p className="text-sm mt-1">{testResult.message}</p>
                      )}
                      {testResult?.error && typeof testResult.error === 'string' && (
                        <p className="text-sm mt-1">{testResult.error}</p>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </CardContent>
          </Card>

          {/* AD Trust Domains */}
          <Card>
            <CardHeader>
              <CardTitle>Active Directory Trust</CardTitle>
              <CardDescription>
                Configure trusted AD domains for users authenticating via AD Trust (e.g., user@corp.local)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  AD Trust users from these domains will authenticate using their full UPN (user@domain) 
                  and be searched in the FreeIPA compat tree (cn=users,cn=compat).
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <Label>Trusted AD Domains</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g., corp.local or neopost.ad"
                    value={newTrustedDomain}
                    onChange={(e) => setNewTrustedDomain(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddTrustedDomain()}
                  />
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={handleAddTrustedDomain}
                    disabled={!newTrustedDomain.trim()}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Enter domain names for trusted Active Directory realms
                </p>
              </div>

              {trustedDomains.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {trustedDomains.map((domain) => (
                    <Badge key={domain} variant="secondary" className="flex items-center gap-1">
                      {domain}
                      <button
                        type="button"
                        onClick={() => handleRemoveTrustedDomain(domain)}
                        className="ml-1 hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  No trusted domains configured. Users with @domain suffixes not matching the FreeIPA realm 
                  will still attempt AD Trust authentication (permissive mode).
                </p>
              )}
            </CardContent>
          </Card>

          {/* Test Authentication */}
          <Card>
            <CardHeader>
              <CardTitle>Test IDM Authentication</CardTitle>
              <CardDescription>Verify user credentials and group mappings without logging in</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  This tests authentication and role mapping without creating a session or provisioning the user.
                </AlertDescription>
              </Alert>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Username</Label>
                  <Input
                    placeholder="jsmith"
                    value={testAuthUsername}
                    onChange={(e) => setTestAuthUsername(e.target.value)}
                    disabled={testAuthStatus === 'testing'}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Password</Label>
                  <Input
                    type="password"
                    placeholder="Enter password"
                    value={testAuthPassword}
                    onChange={(e) => setTestAuthPassword(e.target.value)}
                    disabled={testAuthStatus === 'testing'}
                  />
                </div>
              </div>

              <Button 
                onClick={handleTestAuth} 
                variant="outline"
                disabled={!canTestAuth || testAuthStatus === 'testing'}
              >
                {testAuthStatus === 'testing' ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <TestTube className="mr-2 h-4 w-4" />
                    Test Authentication
                  </>
                )}
              </Button>

              {testAuthStatus === 'testing' && (
                <Alert>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <AlertDescription>Authenticating user '{testAuthUsername}'...</AlertDescription>
                </Alert>
              )}

              {testAuthStatus === 'success' && testAuthResult && (
                <Alert className="border-green-500 bg-green-50 dark:bg-green-950/20">
                  <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <AlertDescription className="text-green-800 dark:text-green-200">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-base">✅ Authentication Successful</p>
                        {testAuthResult.is_ad_trust_user && (
                          <Badge variant="outline" className="text-xs">AD Trust User</Badge>
                        )}
                      </div>
                      
                      <div className="space-y-2 text-sm">
                        <div>
                          <p className="font-medium">User Details:</p>
                          <p>Full Name: {testAuthResult.full_name || 'N/A'}</p>
                          <p>Email: {testAuthResult.email || 'N/A'}</p>
                          {testAuthResult.title && <p>Title: {testAuthResult.title}</p>}
                          {testAuthResult.department && <p>Department: {testAuthResult.department}</p>}
                          {testAuthResult.ad_domain && <p>AD Domain: {testAuthResult.ad_domain}</p>}
                        </div>
                        
                        <div>
                          <p className="font-medium">User DN:</p>
                          <p className="font-mono text-xs break-all">{testAuthResult.user_dn}</p>
                        </div>
                        
                        {testAuthResult.groups && testAuthResult.groups.length > 0 && (
                          <div>
                            <p className="font-medium">Groups ({testAuthResult.group_count}):</p>
                            <ul className="list-disc list-inside space-y-1 ml-2">
                              {testAuthResult.groups.slice(0, 5).map((group: string, idx: number) => (
                                <li key={idx} className="font-mono text-xs break-all">{group}</li>
                              ))}
                              {testAuthResult.groups.length > 5 && (
                                <li className="text-muted-foreground">...and {testAuthResult.groups.length - 5} more</li>
                              )}
                            </ul>
                          </div>
                        )}
                        
                        <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded border border-green-300 dark:border-green-700">
                          <p className="font-medium">Role Mapping:</p>
                          {testAuthResult.matched_group ? (
                            <>
                              <p>Matched Group: <span className="font-mono">{testAuthResult.matched_group}</span></p>
                              <p>Assigned Role: <span className="font-semibold uppercase">{testAuthResult.mapped_role}</span></p>
                            </>
                          ) : (
                            <p>No group mapping matched. Default role: <span className="font-semibold uppercase">{testAuthResult.mapped_role}</span></p>
                          )}
                        </div>
                      </div>
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {testAuthStatus === 'error' && testAuthResult && (
                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertDescription>
                    <p className="font-medium">❌ Authentication Failed</p>
                    {testAuthResult.error && (
                      <p className="text-sm mt-1">{testAuthResult.error}</p>
                    )}
                  </AlertDescription>
                </Alert>
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
        </>
      )}
    </div>
  );
}
