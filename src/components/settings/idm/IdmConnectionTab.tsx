import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useIdmSettings } from '@/hooks/useIdmSettings';
import { 
  AlertCircle, Loader2, Save, ChevronDown, Server, Shield, 
  Building2, FolderTree, TestTube, CheckCircle, XCircle, 
  Lock, Unlock, Plus, X, Wifi 
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

// Helper functions
function hostToBaseDn(host: string): string {
  return host.split('.').map(part => `dc=${part}`).join(',');
}

function usernameToBindDn(username: string, baseDn: string): string {
  const user = username.includes('@') ? username.split('@')[0] : username;
  return `uid=${user},cn=users,cn=accounts,${baseDn}`;
}

export function IdmConnectionTab() {
  const { settings, loading, saving, saveSettings, testConnection } = useIdmSettings();

  // Collapsible states
  const [authModeOpen, setAuthModeOpen] = useState(true);
  const [freeipaOpen, setFreeipaOpen] = useState(false);
  const [adTrustOpen, setAdTrustOpen] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);

  // Form states
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

  // Directory settings
  const [userSearchBase, setUserSearchBase] = useState(settings?.user_search_base || 'cn=users,cn=accounts');
  const [groupSearchBase, setGroupSearchBase] = useState(settings?.group_search_base || 'cn=groups,cn=accounts');
  const [caCertificate, setCaCertificate] = useState(settings?.ca_certificate || '');

  // AD Trust settings
  const [trustedDomains, setTrustedDomains] = useState<string[]>([]);
  const [newTrustedDomain, setNewTrustedDomain] = useState('');
  const [adDcHost, setAdDcHost] = useState('');
  const [adDcPort, setAdDcPort] = useState(636);
  const [adDcUseSsl, setAdDcUseSsl] = useState(true);
  const [adDomainFqdn, setAdDomainFqdn] = useState('');
  const [adBindDn, setAdBindDn] = useState('');
  const [adBindPassword, setAdBindPassword] = useState('');

  // Test states
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testResult, setTestResult] = useState<any>(null);
  const [adTestStatus, setAdTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [adTestResult, setAdTestResult] = useState<any>(null);

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
      setUserSearchBase(settings.user_search_base || 'cn=users,cn=accounts');
      setGroupSearchBase(settings.group_search_base || 'cn=groups,cn=accounts');
      setCaCertificate(settings.ca_certificate || '');
      setTrustedDomains(settings.trusted_domains || []);
      setAdDcHost(settings.ad_dc_host || '');
      setAdDcPort(settings.ad_dc_port || 636);
      setAdDcUseSsl(settings.ad_dc_use_ssl ?? true);
      setAdDomainFqdn(settings.ad_domain_fqdn || '');
      setAdBindDn(settings.ad_bind_dn || '');

      // Extract username from bind_dn
      if (settings.bind_dn) {
        const uidMatch = settings.bind_dn.match(/uid=([^,]+)/);
        if (uidMatch) setServiceUsername(uidMatch[1]);
      }

      // Check if manual base DN
      if (settings.base_dn && settings.server_host) {
        const autoBaseDn = hostToBaseDn(settings.server_host);
        setManualBaseDn(settings.base_dn !== autoBaseDn);
      }

      // Auto-expand relevant sections
      if (settings.auth_mode !== 'local_only') {
        setFreeipaOpen(true);
        if (settings.ad_dc_host || (settings.trusted_domains?.length ?? 0) > 0) {
          setAdTrustOpen(true);
        }
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
      user_search_base: userSearchBase,
      group_search_base: groupSearchBase,
      ca_certificate: caCertificate,
      trusted_domains: trustedDomains,
      ad_dc_host: adDcHost || null,
      ad_dc_port: adDcPort,
      ad_dc_use_ssl: adDcUseSsl,
      ad_domain_fqdn: adDomainFqdn || null,
      ad_bind_dn: adBindDn || null,
    };

    if (bindPassword) updates.bind_password_encrypted = bindPassword;
    await saveSettings(updates);
    setBindPassword('');

    if (adBindPassword && settings?.id) {
      try {
        await supabase.functions.invoke('encrypt-credentials', {
          body: { type: 'idm_ad_bind', idm_settings_id: settings.id, password: adBindPassword },
        });
        setAdBindPassword('');
      } catch (error) {
        console.error('Failed to encrypt AD bind password:', error);
      }
    }
  };

  const handleServerHostChange = (host: string) => {
    setServerHost(host);
    if (!manualBaseDn && host.includes('.')) {
      const autoBaseDn = hostToBaseDn(host);
      setBaseDn(autoBaseDn);
      if (serviceUsername) setBindDn(usernameToBindDn(serviceUsername, autoBaseDn));
    }
  };

  const handleUsernameChange = (input: string) => {
    setServiceUsername(input);
    if (baseDn) setBindDn(usernameToBindDn(input, baseDn));
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
      user_search_base: userSearchBase,
      group_search_base: groupSearchBase,
      bind_dn: bindDn,
      bind_password: bindPassword || undefined,
      ca_certificate: caCertificate,
      connection_timeout_seconds: connectionTimeout,
      use_saved_password: !bindPassword && !!settings?.bind_password_encrypted,
    });
    
    if (job?.id) pollJobStatus(job.id);
  };

  const pollJobStatus = async (jobId: string) => {
    const maxAttempts = 30;
    let attempts = 0;
    
    const poll = async () => {
      attempts++;
      const { data: job } = await supabase.from('jobs').select('*').eq('id', jobId).single();
      
      if (!job) return;
      
      if (job.status === 'completed' || job.status === 'failed') {
        const details = job.details as any;
        const testResult = details?.test_result || details;
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

  const handleTestAdConnection = async () => {
    setAdTestStatus('testing');
    setAdTestResult(null);
    
    const { data: job, error } = await supabase
      .from('jobs')
      .insert({
        job_type: 'idm_test_ad_connection' as any,
        status: 'pending',
        details: {
          ad_dc_host: adDcHost,
          ad_dc_port: adDcPort,
          ad_dc_use_ssl: adDcUseSsl,
          ad_bind_dn: adBindDn,
          ad_bind_password: adBindPassword || undefined,
          use_saved_password: !adBindPassword && !!settings?.ad_bind_password_encrypted,
        },
        created_by: (await supabase.auth.getUser()).data.user?.id || '',
      })
      .select()
      .single();
    
    if (error || !job) {
      setAdTestStatus('error');
      setAdTestResult({ error: 'Failed to create AD connection test job' });
      return;
    }
    
    pollAdTestStatus(job.id);
  };

  const pollAdTestStatus = async (jobId: string) => {
    const maxAttempts = 30;
    let attempts = 0;
    
    const poll = async () => {
      attempts++;
      const { data: job } = await supabase.from('jobs').select('*').eq('id', jobId).single();
      
      if (!job) return;
      
      if (job.status === 'completed' || job.status === 'failed') {
        const details = job.details as any;
        const result = details?.test_result || details || {};
        setAdTestResult(result);
        setAdTestStatus(result.success ? 'success' : 'error');
        return;
      }
      
      if (attempts < maxAttempts && (job.status === 'pending' || job.status === 'running')) {
        setTimeout(poll, 1000);
      } else {
        setAdTestStatus('error');
        setAdTestResult({ error: 'AD connection test timed out' });
      }
    };
    
    poll();
  };

  const canTestConnection = serverHost && bindDn && (bindPassword || settings?.bind_password_encrypted) && baseDn;
  const canTestAdConnection = adDcHost && adBindDn && (adBindPassword || settings?.ad_bind_password_encrypted);
  const isIdmEnabled = authMode !== 'local_only';
  const isConfigured = settings?.server_host && settings?.bind_dn && settings?.bind_password_encrypted;

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Authentication Mode - Always visible */}
      <Collapsible open={authModeOpen} onOpenChange={setAuthModeOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <CardTitle className="text-base">Authentication Mode</CardTitle>
                    <CardDescription>Configure how users authenticate</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={isIdmEnabled ? 'default' : 'secondary'}>
                    {authMode === 'local_only' && 'Local Only'}
                    {authMode === 'idm_primary' && 'IDM Primary'}
                    {authMode === 'idm_fallback' && 'IDM Fallback'}
                  </Badge>
                  <ChevronDown className={`h-4 w-4 transition-transform ${authModeOpen ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-4 pt-0">
              <Separator />
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
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* FreeIPA Server */}
      {isIdmEnabled && (
        <Collapsible open={freeipaOpen} onOpenChange={setFreeipaOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Server className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <CardTitle className="text-base">FreeIPA Server</CardTitle>
                      <CardDescription>Primary LDAP server connection</CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isConfigured ? (
                      <Badge variant="default" className="bg-green-600">Configured</Badge>
                    ) : (
                      <Badge variant="secondary">Not Configured</Badge>
                    )}
                    <ChevronDown className={`h-4 w-4 transition-transform ${freeipaOpen ? 'rotate-180' : ''}`} />
                  </div>
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4 pt-0">
                <Separator />
                
                {/* Server Connection */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Server Host</Label>
                    <Input
                      placeholder="idm.example.com"
                      value={serverHost}
                      onChange={(e) => handleServerHostChange(e.target.value)}
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
                    <Input type="number" value={serverPort} onChange={(e) => setServerPort(parseInt(e.target.value))} disabled={useLdaps} />
                  </div>
                  <div className="space-y-2">
                    <Label>LDAPS Port</Label>
                    <Input type="number" value={ldapsPort} onChange={(e) => setLdapsPort(parseInt(e.target.value))} disabled={!useLdaps} />
                  </div>
                </div>

                {useLdaps && (
                  <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="space-y-0.5">
                      <Label>Verify SSL Certificate</Label>
                      <p className="text-sm text-muted-foreground">Validate server certificate</p>
                    </div>
                    <Switch checked={verifyCertificate} onCheckedChange={setVerifyCertificate} />
                  </div>
                )}

                <Separator />

                {/* Service Account */}
                <div className="space-y-4">
                  <h4 className="font-medium">Service Account</h4>
                  
                  <div className="space-y-2">
                    <Label>Base DN</Label>
                    <Input
                      placeholder="dc=example,dc=com"
                      value={baseDn}
                      onChange={(e) => { setBaseDn(e.target.value); setManualBaseDn(true); }}
                    />
                    <p className="text-sm text-muted-foreground">
                      {!manualBaseDn && serverHost ? `Auto-derived: ${hostToBaseDn(serverHost)}` : 'Enter manually or derived from server host'}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Service Account Username</Label>
                    <Input
                      placeholder="svc_dsm"
                      value={serviceUsername}
                      onChange={(e) => handleUsernameChange(e.target.value)}
                    />
                  </div>

                  {bindDn && (
                    <div className="p-3 bg-muted/50 rounded-lg border">
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
                  </div>

                  {/* Test Connection */}
                  <div className="space-y-3">
                    <Button onClick={handleTestConnection} variant="outline" disabled={!canTestConnection || testStatus === 'testing'}>
                      {testStatus === 'testing' ? (
                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Testing...</>
                      ) : (
                        <><TestTube className="mr-2 h-4 w-4" />Test Connection</>
                      )}
                    </Button>

                    {testStatus === 'success' && (
                      <Alert className="border-green-500 bg-green-50 dark:bg-green-950/20">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <AlertDescription className="text-green-800 dark:text-green-200">
                          Connection successful! {testResult?.response_time_ms && `(${testResult.response_time_ms}ms)`}
                        </AlertDescription>
                      </Alert>
                    )}

                    {testStatus === 'error' && (
                      <Alert variant="destructive">
                        <XCircle className="h-4 w-4" />
                        <AlertDescription>
                          Connection failed: {testResult?.error || testResult?.message || 'Unknown error'}
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* Active Directory Trust */}
      {isIdmEnabled && (
        <Collapsible open={adTrustOpen} onOpenChange={setAdTrustOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Building2 className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <CardTitle className="text-base">Active Directory Integration</CardTitle>
                      <CardDescription>Configure AD trust domains and pass-through authentication</CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {trustedDomains.length > 0 && (
                      <Badge variant="outline">{trustedDomains.length} domain(s)</Badge>
                    )}
                    {adDcHost && <Badge variant="default" className="bg-blue-600">DC Configured</Badge>}
                    <ChevronDown className={`h-4 w-4 transition-transform ${adTrustOpen ? 'rotate-180' : ''}`} />
                  </div>
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4 pt-0">
                <Separator />

                {/* Trusted Domains */}
                <div className="space-y-2">
                  <Label>Trusted AD Domains</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="e.g., corp.local"
                      value={newTrustedDomain}
                      onChange={(e) => setNewTrustedDomain(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddTrustedDomain()}
                    />
                    <Button variant="outline" onClick={handleAddTrustedDomain} disabled={!newTrustedDomain.trim()}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  {trustedDomains.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {trustedDomains.map((domain) => (
                        <Badge key={domain} variant="secondary" className="flex items-center gap-1">
                          {domain}
                          <button onClick={() => handleRemoveTrustedDomain(domain)} className="ml-1 hover:text-destructive">
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                <Separator />

                {/* AD Domain Controller */}
                <div className="space-y-4">
                  <h4 className="font-medium">AD Domain Controller (Pass-through)</h4>

                  <div className="space-y-2">
                    <Label>AD Domain FQDN</Label>
                    <Input placeholder="e.g., corp.local" value={adDomainFqdn} onChange={(e) => setAdDomainFqdn(e.target.value)} />
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2 space-y-2">
                      <Label>AD DC Host</Label>
                      <Input placeholder="dc01.corp.local" value={adDcHost} onChange={(e) => setAdDcHost(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Port</Label>
                      <Input type="number" value={adDcPort} onChange={(e) => setAdDcPort(parseInt(e.target.value))} />
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="space-y-0.5">
                      <Label>Use LDAPS for AD</Label>
                      <p className="text-sm text-muted-foreground">Encrypt AD connection</p>
                    </div>
                    <Switch checked={adDcUseSsl} onCheckedChange={(checked) => { setAdDcUseSsl(checked); setAdDcPort(checked ? 636 : 389); }} />
                  </div>

                  {adDcHost && (
                    <>
                      <Separator />
                      <h4 className="font-medium">AD Service Account</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>AD Bind DN / Username</Label>
                          <Input placeholder="svc_ldap@corp.local" value={adBindDn} onChange={(e) => setAdBindDn(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                          <Label>AD Bind Password</Label>
                          <Input type="password" placeholder={settings?.ad_bind_password_encrypted ? '••••••••' : 'Enter password'} value={adBindPassword} onChange={(e) => setAdBindPassword(e.target.value)} />
                        </div>
                      </div>

                      <Button onClick={handleTestAdConnection} variant="outline" disabled={!canTestAdConnection || adTestStatus === 'testing'}>
                        {adTestStatus === 'testing' ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Testing AD...</>
                        ) : (
                          <><TestTube className="mr-2 h-4 w-4" />Test AD Connection</>
                        )}
                      </Button>

                      {adTestStatus === 'success' && (
                        <Alert className="border-green-500 bg-green-50 dark:bg-green-950/20">
                          <CheckCircle className="h-4 w-4 text-green-600" />
                          <AlertDescription>AD connection successful!</AlertDescription>
                        </Alert>
                      )}

                      {adTestStatus === 'error' && (
                        <Alert variant="destructive">
                          <XCircle className="h-4 w-4" />
                          <AlertDescription>AD connection failed: {adTestResult?.error || 'Unknown error'}</AlertDescription>
                        </Alert>
                      )}
                    </>
                  )}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* Directory Structure */}
      {isIdmEnabled && (
        <Collapsible open={directoryOpen} onOpenChange={setDirectoryOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FolderTree className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <CardTitle className="text-base">Directory Structure</CardTitle>
                      <CardDescription>LDAP search bases and CA certificate</CardDescription>
                    </div>
                  </div>
                  <ChevronDown className={`h-4 w-4 transition-transform ${directoryOpen ? 'rotate-180' : ''}`} />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4 pt-0">
                <Separator />

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>User Search Base</Label>
                    <Input value={userSearchBase} onChange={(e) => setUserSearchBase(e.target.value)} placeholder="cn=users,cn=accounts" />
                    <p className="text-sm text-muted-foreground">Relative to Base DN</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Group Search Base</Label>
                    <Input value={groupSearchBase} onChange={(e) => setGroupSearchBase(e.target.value)} placeholder="cn=groups,cn=accounts" />
                    <p className="text-sm text-muted-foreground">Relative to Base DN</p>
                  </div>
                </div>

                {useLdaps && verifyCertificate && (
                  <div className="space-y-2">
                    <Label>CA Certificate (PEM)</Label>
                    <Textarea
                      placeholder="-----BEGIN CERTIFICATE-----&#10;..."
                      value={caCertificate}
                      onChange={(e) => setCaCertificate(e.target.value)}
                      rows={6}
                      className="font-mono text-sm"
                    />
                    <p className="text-sm text-muted-foreground">Required for SSL certificate verification</p>
                  </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>
          ) : (
            <><Save className="mr-2 h-4 w-4" />Save Settings</>
          )}
        </Button>
      </div>
    </div>
  );
}
