import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { Network, Activity, Terminal, Database, Loader2, Key, Eye, Copy, Server, CheckCircle, XCircle, ExternalLink } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { setJobExecutorUrl, getJobExecutorUrl, testJobExecutorConnection, initializeJobExecutorUrl } from "@/lib/job-executor-api";

export function SystemSettings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [jobCleaningUp, setJobCleaningUp] = useState(false);

  // Job Executor Settings
  const [jobExecutorUrl, setJobExecutorUrlState] = useState(getJobExecutorUrl());
  const [jobExecutorTesting, setJobExecutorTesting] = useState(false);
  const [jobExecutorStatus, setJobExecutorStatus] = useState<'unknown' | 'connected' | 'failed'>('unknown');

  // Network Settings
  const [networkSettingsId, setNetworkSettingsId] = useState<string | null>(null);
  const [connectionTimeout, setConnectionTimeout] = useState(30);
  const [readTimeout, setReadTimeout] = useState(60);
  const [operationTimeout, setOperationTimeout] = useState(300);
  const [maxRetryAttempts, setMaxRetryAttempts] = useState(3);
  const [retryBackoffType, setRetryBackoffType] = useState<'exponential' | 'linear' | 'fixed'>('exponential');
  const [retryDelay, setRetryDelay] = useState(2);

  // Activity Monitor Settings
  const [activitySettingsId, setActivitySettingsId] = useState<string | null>(null);
  const [logRetentionDays, setLogRetentionDays] = useState(30);
  const [autoCleanupEnabled, setAutoCleanupEnabled] = useState(true);
  const [lastCleanupAt, setLastCleanupAt] = useState<string | null>(null);
  const [logLevel, setLogLevel] = useState<'all' | 'errors_only' | 'slow_only'>('all');
  const [slowCommandThreshold, setSlowCommandThreshold] = useState(5000);

  // Job Settings
  const [jobRetentionDays, setJobRetentionDays] = useState(90);
  const [jobAutoCleanupEnabled, setJobAutoCleanupEnabled] = useState(true);
  const [jobLastCleanupAt, setJobLastCleanupAt] = useState<string | null>(null);
  const [stalePendingHours, setStalePendingHours] = useState(24);
  const [staleRunningHours, setStaleRunningHours] = useState(48);
  const [autoCancelStaleJobs, setAutoCancelStaleJobs] = useState(true);
  const [staleJobCount, setStaleJobCount] = useState(0);

  // Service Key
  const [serviceKey, setServiceKey] = useState<string | null>(null);
  const [serviceKeyLoading, setServiceKeyLoading] = useState(false);
  const [serviceKeyRevealed, setServiceKeyRevealed] = useState(false);

  useEffect(() => {
    loadNetworkSettings();
    loadActivitySettings();
    fetchStaleJobCount();
  }, []);

  const loadNetworkSettings = async () => {
    const { data } = await supabase
      .from('network_settings')
      .select('*')
      .maybeSingle();

    if (data) {
      setNetworkSettingsId(data.id);
      setConnectionTimeout(data.connection_timeout_seconds);
      setReadTimeout(data.read_timeout_seconds);
      setOperationTimeout(data.operation_timeout_seconds);
      setMaxRetryAttempts(data.max_retry_attempts);
      setRetryBackoffType(data.retry_backoff_type as 'exponential' | 'linear' | 'fixed');
      setRetryDelay(data.retry_delay_seconds);
    }
  };

  const loadActivitySettings = async () => {
    const { data } = await supabase
      .from('activity_settings')
      .select('*')
      .maybeSingle();

    if (data) {
      setActivitySettingsId(data.id);
      setLogRetentionDays(data.log_retention_days);
      setAutoCleanupEnabled(data.auto_cleanup_enabled);
      setLastCleanupAt(data.last_cleanup_at);
      setLogLevel(data.log_level as 'all' | 'errors_only' | 'slow_only');
      setSlowCommandThreshold(data.slow_command_threshold_ms);
      setJobRetentionDays(data.job_retention_days || 90);
      setJobAutoCleanupEnabled(data.job_auto_cleanup_enabled ?? true);
      setJobLastCleanupAt(data.job_last_cleanup_at);
      setStalePendingHours(data.stale_pending_hours || 24);
      setStaleRunningHours(data.stale_running_hours || 48);
      setAutoCancelStaleJobs(data.auto_cancel_stale_jobs ?? true);
      
      // Load Job Executor URL from database
      if (data.job_executor_url) {
        setJobExecutorUrlState(data.job_executor_url);
        initializeJobExecutorUrl(data.job_executor_url);
      }
    }
  };

  const fetchStaleJobCount = async () => {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { count: pendingCount } = await supabase
      .from('jobs')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')
      .lt('created_at', twentyFourHoursAgo);

    const { count: runningCount } = await supabase
      .from('jobs')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'running')
      .lt('started_at', fortyEightHoursAgo);

    setStaleJobCount((pendingCount || 0) + (runningCount || 0));
  };

  const handleSaveNetworkSettings = async () => {
    setLoading(true);
    try {
      const settings = {
        connection_timeout_seconds: connectionTimeout,
        read_timeout_seconds: readTimeout,
        operation_timeout_seconds: operationTimeout,
        max_retry_attempts: maxRetryAttempts,
        retry_backoff_type: retryBackoffType,
        retry_delay_seconds: retryDelay,
      };

      if (networkSettingsId) {
        await supabase
          .from('network_settings')
          .update(settings)
          .eq('id', networkSettingsId);
      } else {
        const { data } = await supabase
          .from('network_settings')
          .insert([settings])
          .select()
          .single();
        if (data) setNetworkSettingsId(data.id);
      }

      toast({
        title: "Success",
        description: "Network settings saved",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveActivitySettings = async () => {
    setLoading(true);
    try {
      const settings = {
        log_retention_days: logRetentionDays,
        auto_cleanup_enabled: autoCleanupEnabled,
        log_level: logLevel,
        slow_command_threshold_ms: slowCommandThreshold,
        job_retention_days: jobRetentionDays,
        job_auto_cleanup_enabled: jobAutoCleanupEnabled,
        stale_pending_hours: stalePendingHours,
        stale_running_hours: staleRunningHours,
        auto_cancel_stale_jobs: autoCancelStaleJobs,
      };

      if (activitySettingsId) {
        await supabase
          .from('activity_settings')
          .update(settings)
          .eq('id', activitySettingsId);
      } else {
        const { data } = await supabase
          .from('activity_settings')
          .insert([settings])
          .select()
          .single();
        if (data) setActivitySettingsId(data.id);
      }

      toast({
        title: "Success",
        description: "Settings saved",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCleanupNow = async () => {
    setCleaningUp(true);
    try {
      await supabase.functions.invoke('cleanup-activity-logs');
      toast({
        title: "Cleanup Started",
        description: "Activity logs are being cleaned up",
      });
      setTimeout(() => loadActivitySettings(), 2000);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setCleaningUp(false);
    }
  };

  const handleJobCleanupNow = async () => {
    setJobCleaningUp(true);
    try {
      await supabase.functions.invoke('cleanup-old-jobs');
      toast({
        title: "Cleanup Started",
        description: "Old jobs are being cleaned up",
      });
      setTimeout(() => loadActivitySettings(), 2000);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setJobCleaningUp(false);
    }
  };

  const handleRevealServiceKey = async () => {
    setServiceKeyLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-service-key');
      if (error) throw error;
      setServiceKey(data.service_role_key);
      setServiceKeyRevealed(true);
      toast({
        title: "Service Key Retrieved",
        description: "Copy this key to your Job Executor .env file",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to retrieve service key",
        variant: "destructive",
      });
    } finally {
      setServiceKeyLoading(false);
    }
  };

  const handleTestJobExecutor = async () => {
    setJobExecutorTesting(true);
    setJobExecutorStatus('unknown');
    
    const result = await testJobExecutorConnection(jobExecutorUrl);
    
    if (result.success) {
      setJobExecutorStatus('connected');
      toast({
        title: "Connection Successful",
        description: "Job Executor is reachable",
      });
    } else {
      setJobExecutorStatus('failed');
      toast({
        title: "Connection Failed",
        description: result.message,
        variant: "destructive",
      });
    }
    
    setJobExecutorTesting(false);
  };

  const handleSaveJobExecutorUrl = async () => {
    setLoading(true);
    try {
      // Update in memory and localStorage
      setJobExecutorUrl(jobExecutorUrl);
      
      // Save to database
      if (activitySettingsId) {
        await supabase
          .from('activity_settings')
          .update({ job_executor_url: jobExecutorUrl })
          .eq('id', activitySettingsId);
      } else {
        const { data } = await supabase
          .from('activity_settings')
          .insert([{ job_executor_url: jobExecutorUrl }])
          .select()
          .single();
        if (data) setActivitySettingsId(data.id);
      }

      toast({
        title: "Success",
        description: "Job Executor URL saved",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Job Executor Connection */}
      <SettingsSection
        id="job-executor"
        title="Job Executor Connection"
        description="Configure the URL for the Job Executor service"
        icon={Server}
      >
        <div className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              The Job Executor runs on your server and handles iDRAC operations. 
              When accessing this app remotely, set this to your server's IP/hostname 
              (e.g., <code className="px-1 bg-muted rounded text-xs">http://192.168.1.100:8081</code>).
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label>Job Executor URL</Label>
            <div className="flex gap-2">
              <Input
                type="url"
                value={jobExecutorUrl}
                onChange={(e) => setJobExecutorUrlState(e.target.value)}
                placeholder="http://localhost:8081"
                className="font-mono"
              />
              <Button
                variant="outline"
                onClick={handleTestJobExecutor}
                disabled={jobExecutorTesting}
              >
                {jobExecutorTesting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : jobExecutorStatus === 'connected' ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : jobExecutorStatus === 'failed' ? (
                  <XCircle className="h-4 w-4 text-destructive" />
                ) : (
                  'Test'
                )}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Use <code className="px-1 bg-muted rounded text-xs">http://localhost:8081</code> when 
              accessing from the same machine, or use the server's IP when accessing remotely.
            </p>
          </div>

          {jobExecutorStatus === 'connected' && (
            <Alert className="border-green-500/50 bg-green-500/10">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <AlertDescription className="text-green-700 dark:text-green-400">
                Job Executor is connected and responding
              </AlertDescription>
            </Alert>
          )}

          {jobExecutorStatus === 'failed' && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription>
                Cannot reach Job Executor. Ensure it's running and the URL is correct.
                {jobExecutorUrl.startsWith('http://') && window.location.protocol === 'https:' && (
                  <span className="block mt-2 font-medium">
                    Note: You're accessing this app over HTTPS but trying to connect to HTTP. 
                    Enable SSL on the Job Executor or use HTTPS URL.
                  </span>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* HTTPS/SSL Guidance */}
          <Alert className="border-amber-500/50 bg-amber-500/10">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-700 dark:text-amber-400">
              <strong>Remote HTTPS Access:</strong> If accessing this app over HTTPS from a remote browser, 
              the Job Executor must also use HTTPS.
              
              <Tabs defaultValue="windows" className="mt-3">
                <TabsList className="h-8">
                  <TabsTrigger value="windows" className="text-xs px-3 py-1">Windows</TabsTrigger>
                  <TabsTrigger value="linux" className="text-xs px-3 py-1">Linux/RHEL</TabsTrigger>
                </TabsList>
                
                <TabsContent value="windows" className="mt-2 space-y-2">
                  <p className="text-xs">1. Generate SSL certificate (uses OpenSSL):</p>
                  <code className="block px-2 py-1 bg-muted rounded text-xs">
                    C:\dell-server-manager\scripts\generate-ssl-cert.ps1
                  </code>
                  <p className="text-xs">2. Set all environment variables together (NSSM overwrites, doesn't append):</p>
                  <code className="block px-2 py-1 bg-muted rounded text-xs whitespace-pre-wrap break-all">
{`nssm set DellServerManagerJobExecutor AppEnvironmentExtra "SERVICE_ROLE_KEY=<your-key>" "DSM_URL=<your-supabase-url>" "API_SERVER_SSL_ENABLED=true" "API_SERVER_SSL_CERT=C:\\dell-server-manager\\ssl\\server.crt" "API_SERVER_SSL_KEY=C:\\dell-server-manager\\ssl\\server.key"`}
                  </code>
                  <p className="text-xs text-amber-600 dark:text-amber-400">⚠️ Replace &lt;your-key&gt; and &lt;your-supabase-url&gt; with actual values</p>
                  <p className="text-xs">3. Restart service:</p>
                  <code className="block px-2 py-1 bg-muted rounded text-xs">
                    nssm restart DellServerManagerJobExecutor
                  </code>
                </TabsContent>
                
                <TabsContent value="linux" className="mt-2 space-y-2">
                  <p className="text-xs">1. Generate SSL certificate (uses OpenSSL):</p>
                  <code className="block px-2 py-1 bg-muted rounded text-xs">
                    sudo /opt/job-executor/generate-ssl-cert.sh
                  </code>
                  <p className="text-xs">2. Enable SSL in <code className="px-1 bg-muted rounded">/opt/job-executor/.env</code>:</p>
                  <code className="block px-2 py-1 bg-muted rounded text-xs">
                    API_SERVER_SSL_ENABLED=true
                  </code>
                  <p className="text-xs">3. Restart service:</p>
                  <code className="block px-2 py-1 bg-muted rounded text-xs">
                    sudo systemctl restart dell-job-executor
                  </code>
                </TabsContent>
              </Tabs>
              
              {/* Trust Certificate Button */}
              {jobExecutorUrl.startsWith('https://') && (
                <div className="mt-3 pt-3 border-t border-amber-500/30">
                  <p className="text-xs mb-2">
                    <strong>Self-signed certificate?</strong> Open the health endpoint to accept it in your browser:
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => window.open(`${jobExecutorUrl}/api/health`, '_blank')}
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Trust Certificate
                  </Button>
                </div>
              )}
            </AlertDescription>
          </Alert>

          <Button onClick={handleSaveJobExecutorUrl} disabled={loading}>
            {loading ? "Saving..." : "Save Job Executor URL"}
          </Button>
        </div>
      </SettingsSection>

      {/* Network Settings */}
      <SettingsSection
        id="network"
        title="Network Configuration"
        description="Timeout and retry settings for API calls"
        icon={Network}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Connection Timeout (s)</Label>
              <Input
                type="number"
                value={connectionTimeout}
                onChange={(e) => setConnectionTimeout(parseInt(e.target.value) || 30)}
                min={5}
                max={120}
              />
            </div>
            <div className="space-y-2">
              <Label>Read Timeout (s)</Label>
              <Input
                type="number"
                value={readTimeout}
                onChange={(e) => setReadTimeout(parseInt(e.target.value) || 60)}
                min={10}
                max={300}
              />
            </div>
            <div className="space-y-2">
              <Label>Operation Timeout (s)</Label>
              <Input
                type="number"
                value={operationTimeout}
                onChange={(e) => setOperationTimeout(parseInt(e.target.value) || 300)}
                min={60}
                max={600}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Max Retry Attempts</Label>
            <Input
              type="number"
              value={maxRetryAttempts}
              onChange={(e) => setMaxRetryAttempts(parseInt(e.target.value) || 3)}
              min={0}
              max={10}
            />
          </div>

          <div className="space-y-2">
            <Label>Retry Backoff</Label>
            <Select value={retryBackoffType} onValueChange={(v) => setRetryBackoffType(v as 'exponential' | 'linear' | 'fixed')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="exponential">Exponential</SelectItem>
                <SelectItem value="linear">Linear</SelectItem>
                <SelectItem value="fixed">Fixed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button onClick={handleSaveNetworkSettings} disabled={loading}>
            {loading ? "Saving..." : "Save Network Settings"}
          </Button>
        </div>
      </SettingsSection>

      {/* Activity Monitor */}
      <SettingsSection
        id="activity"
        title="Activity Monitor"
        description="Configure activity log retention and monitoring"
        icon={Terminal}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Log Retention (days)</Label>
            <Input
              type="number"
              value={logRetentionDays}
              onChange={(e) => setLogRetentionDays(parseInt(e.target.value) || 30)}
              min={1}
              max={365}
            />
            <p className="text-sm text-muted-foreground">
              Activity logs older than this will be automatically deleted
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Auto-Cleanup</Label>
              <p className="text-sm text-muted-foreground">
                Automatically delete old logs
              </p>
            </div>
            <Switch
              checked={autoCleanupEnabled}
              onCheckedChange={setAutoCleanupEnabled}
            />
          </div>

          <div className="space-y-2">
            <Label>Log Level</Label>
            <Select value={logLevel} onValueChange={(v) => setLogLevel(v as 'all' | 'errors_only' | 'slow_only')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All API Calls</SelectItem>
                <SelectItem value="errors_only">Errors Only</SelectItem>
                <SelectItem value="slow_only">Slow Requests Only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Slow Command Threshold (ms)</Label>
            <Input
              type="number"
              value={slowCommandThreshold}
              onChange={(e) => setSlowCommandThreshold(parseInt(e.target.value) || 5000)}
              min={1000}
            />
          </div>

          {lastCleanupAt && (
            <p className="text-sm text-muted-foreground">
              Last cleanup: {new Date(lastCleanupAt).toLocaleString()}
            </p>
          )}

          <div className="flex gap-2">
            <Button onClick={handleSaveActivitySettings} disabled={loading}>
              {loading ? "Saving..." : "Save Activity Settings"}
            </Button>
            <Button
              variant="outline"
              onClick={handleCleanupNow}
              disabled={cleaningUp}
            >
              {cleaningUp ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cleaning...
                </>
              ) : (
                'Cleanup Now'
              )}
            </Button>
          </div>
        </div>
      </SettingsSection>

      {/* Jobs Configuration */}
      <SettingsSection
        id="jobs"
        title="Jobs Configuration"
        description="Manage job retention and stale job handling"
        icon={Database}
      >
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Job Retention</CardTitle>
              <CardDescription>
                Configure how long completed jobs are kept
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Retention Period (days)</Label>
                <Input
                  type="number"
                  value={jobRetentionDays}
                  onChange={(e) => setJobRetentionDays(parseInt(e.target.value) || 90)}
                  min={1}
                  max={365}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Auto-Cleanup</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically delete old jobs
                  </p>
                </div>
                <Switch
                  checked={jobAutoCleanupEnabled}
                  onCheckedChange={setJobAutoCleanupEnabled}
                />
              </div>

              {jobLastCleanupAt && (
                <p className="text-sm text-muted-foreground">
                  Last cleanup: {new Date(jobLastCleanupAt).toLocaleString()}
                </p>
              )}

              <div className="flex gap-2">
                <Button onClick={handleSaveActivitySettings} disabled={loading}>
                  {loading ? "Saving..." : "Save Job Settings"}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleJobCleanupNow}
                  disabled={jobCleaningUp}
                >
                  {jobCleaningUp ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Cleaning...
                    </>
                  ) : (
                    'Cleanup Now'
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Stale Job Management</CardTitle>
              <CardDescription>
                Handle jobs stuck in pending or running state
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Stale Pending Threshold (hours)</Label>
                <Input
                  type="number"
                  value={stalePendingHours}
                  onChange={(e) => setStalePendingHours(parseInt(e.target.value) || 24)}
                  min={1}
                />
                <p className="text-sm text-muted-foreground">
                  Jobs pending longer than this are considered stale
                </p>
              </div>

              <div className="space-y-2">
                <Label>Stale Running Threshold (hours)</Label>
                <Input
                  type="number"
                  value={staleRunningHours}
                  onChange={(e) => setStaleRunningHours(parseInt(e.target.value) || 48)}
                  min={1}
                />
                <p className="text-sm text-muted-foreground">
                  Jobs running longer than this are considered stale
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Auto-Cancel Stale Jobs</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically cancel jobs that exceed thresholds
                  </p>
                </div>
                <Switch
                  checked={autoCancelStaleJobs}
                  onCheckedChange={setAutoCancelStaleJobs}
                />
              </div>

              {staleJobCount > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {staleJobCount} stale job(s) detected
                  </AlertDescription>
                </Alert>
              )}

              <Button onClick={handleSaveActivitySettings} disabled={loading}>
                {loading ? "Saving..." : "Save Stale Job Settings"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </SettingsSection>

      {/* Service Key */}
      <SettingsSection
        id="service-key"
        title="Job Executor Service Key"
        description="API key required for the Job Executor to communicate with the backend"
        icon={Key}
      >
        <div className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              The Job Executor needs this key to authenticate with the backend.
              Keep it secure and never share it publicly.
            </AlertDescription>
          </Alert>

          {serviceKeyRevealed && serviceKey ? (
            <div className="space-y-2">
              <Label>SERVICE_ROLE_KEY</Label>
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={serviceKey}
                  readOnly
                  className="font-mono text-sm"
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(serviceKey);
                    toast({ title: "Copied to clipboard" });
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Add this to your Job Executor .env file:
                <code className="ml-1 px-1 bg-muted rounded text-xs">
                  SERVICE_ROLE_KEY={serviceKey.substring(0, 20)}...
                </code>
              </p>
            </div>
          ) : (
            <Button
              onClick={handleRevealServiceKey}
              disabled={serviceKeyLoading}
              variant="outline"
            >
              {serviceKeyLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Retrieving...
                </>
              ) : (
                <>
                  <Eye className="mr-2 h-4 w-4" />
                  Reveal Service Key
                </>
              )}
            </Button>
          )}
        </div>
      </SettingsSection>
    </div>
  );
}
