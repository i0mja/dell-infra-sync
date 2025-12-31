import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Database, Activity, Loader2, AlertCircle, Trash2 } from "lucide-react";

export function DataRetentionSettings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);

  // Log settings
  const [logRetentionDays, setLogRetentionDays] = useState(30);
  const [autoCleanupEnabled, setAutoCleanupEnabled] = useState(true);
  const [lastCleanupAt, setLastCleanupAt] = useState<string | null>(null);
  const [logLevel, setLogLevel] = useState<'all' | 'errors_only' | 'slow_only'>('all');
  const [slowCommandThreshold, setSlowCommandThreshold] = useState(5000);
  const [showSlaMonitoringJobs, setShowSlaMonitoringJobs] = useState(false);

  // Job settings
  const [jobRetentionDays, setJobRetentionDays] = useState(90);
  const [jobAutoCleanupEnabled, setJobAutoCleanupEnabled] = useState(true);
  const [jobLastCleanupAt, setJobLastCleanupAt] = useState<string | null>(null);
  const [stalePendingHours, setStalePendingHours] = useState(24);
  const [staleRunningHours, setStaleRunningHours] = useState(48);
  const [autoCancelStaleJobs, setAutoCancelStaleJobs] = useState(true);
  const [staleJobCount, setStaleJobCount] = useState(0);

  useEffect(() => {
    loadSettings();
    fetchStaleJobCount();
  }, []);

  const loadSettings = async () => {
    const { data } = await supabase
      .from('activity_settings')
      .select('*')
      .maybeSingle();

    if (data) {
      setSettingsId(data.id);
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
      setShowSlaMonitoringJobs(data.show_sla_monitoring_jobs ?? false);
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

  const handleSave = async () => {
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
        show_sla_monitoring_jobs: showSlaMonitoringJobs,
      };

      if (settingsId) {
        await supabase
          .from('activity_settings')
          .update(settings)
          .eq('id', settingsId);
      } else {
        const { data } = await supabase
          .from('activity_settings')
          .insert([settings])
          .select()
          .single();
        if (data) setSettingsId(data.id);
      }

      toast({ title: "Saved", description: "Retention settings updated" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleCleanupNow = async () => {
    setCleaningUp(true);
    try {
      await Promise.all([
        supabase.functions.invoke('cleanup-activity-logs'),
        supabase.functions.invoke('cleanup-old-jobs')
      ]);
      toast({ title: "Cleanup Started", description: "Logs and jobs are being cleaned up" });
      setTimeout(() => {
        loadSettings();
        fetchStaleJobCount();
      }, 2000);
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setCleaningUp(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Database className="h-4 w-4" />
          Data Retention
        </CardTitle>
        <CardDescription>
          Configure automatic cleanup for logs and jobs
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Activity Logs Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Activity className="h-4 w-4" />
            Activity Logs
          </div>
          
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs">Retention (days)</Label>
              <Input
                type="number"
                value={logRetentionDays}
                onChange={(e) => setLogRetentionDays(parseInt(e.target.value) || 30)}
                min={1}
                max={365}
                className="h-8"
              />
            </div>
            
            <div className="space-y-2">
              <Label className="text-xs">Log Level</Label>
              <Select value={logLevel} onValueChange={(v) => setLogLevel(v as any)}>
                <SelectTrigger className="h-8">
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
              <Label className="text-xs">Slow Threshold (ms)</Label>
              <Input
                type="number"
                value={slowCommandThreshold}
                onChange={(e) => setSlowCommandThreshold(parseInt(e.target.value) || 5000)}
                min={1000}
                className="h-8"
              />
            </div>

            <div className="flex items-center justify-between pt-5">
              <Label className="text-xs">Auto-Cleanup</Label>
              <Switch
                checked={autoCleanupEnabled}
                onCheckedChange={setAutoCleanupEnabled}
              />
            </div>
          </div>

          {lastCleanupAt && (
            <p className="text-xs text-muted-foreground">
              Last cleanup: {new Date(lastCleanupAt).toLocaleString()}
            </p>
          )}
        </div>

        <Separator />

        {/* Jobs Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Database className="h-4 w-4" />
            Jobs
          </div>
          
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs">Retention (days)</Label>
              <Input
                type="number"
                value={jobRetentionDays}
                onChange={(e) => setJobRetentionDays(parseInt(e.target.value) || 90)}
                min={1}
                max={365}
                className="h-8"
              />
            </div>

            <div className="flex items-center justify-between pt-5">
              <Label className="text-xs">Auto-Cleanup</Label>
              <Switch
                checked={jobAutoCleanupEnabled}
                onCheckedChange={setJobAutoCleanupEnabled}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Stale Pending (hours)</Label>
              <Input
                type="number"
                value={stalePendingHours}
                onChange={(e) => setStalePendingHours(parseInt(e.target.value) || 24)}
                min={1}
                className="h-8"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Stale Running (hours)</Label>
              <Input
                type="number"
                value={staleRunningHours}
                onChange={(e) => setStaleRunningHours(parseInt(e.target.value) || 48)}
                min={1}
                className="h-8"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs">Auto-Cancel Stale Jobs</Label>
              <p className="text-xs text-muted-foreground">
                Cancel jobs exceeding thresholds
              </p>
            </div>
            <Switch
              checked={autoCancelStaleJobs}
              onCheckedChange={setAutoCancelStaleJobs}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs">Show SLA Monitoring Jobs</Label>
              <p className="text-xs text-muted-foreground">
                Display replication checks in Activity Monitor
              </p>
            </div>
            <Switch
              checked={showSlaMonitoringJobs}
              onCheckedChange={setShowSlaMonitoringJobs}
            />
          </div>

          {staleJobCount > 0 && (
            <Alert variant="destructive" className="py-2">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                {staleJobCount} stale job(s) detected
              </AlertDescription>
            </Alert>
          )}

          {jobLastCleanupAt && (
            <p className="text-xs text-muted-foreground">
              Last cleanup: {new Date(jobLastCleanupAt).toLocaleString()}
            </p>
          )}
        </div>

        <Separator />

        {/* Actions */}
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={loading} size="sm">
            {loading ? "Saving..." : "Save Settings"}
          </Button>
          <Button
            variant="outline"
            onClick={handleCleanupNow}
            disabled={cleaningUp}
            size="sm"
          >
            {cleaningUp ? (
              <>
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                Cleaning...
              </>
            ) : (
              <>
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Run Cleanup Now
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
