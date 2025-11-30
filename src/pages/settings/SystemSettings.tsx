import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { Network, Activity, Terminal, Database, Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

export function SystemSettings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [jobCleaningUp, setJobCleaningUp] = useState(false);

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

  return (
    <div className="space-y-6">
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
    </div>
  );
}
