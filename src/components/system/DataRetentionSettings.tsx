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
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Database, Activity, Loader2, AlertCircle, Trash2, Eye, HardDrive, TrendingDown } from "lucide-react";

interface CleanupPreview {
  activityLogs: number;
  jobs: {
    total: number;
    background: number;
    user: number;
    tasks: number;
    byType: { jobType: string; count: number }[];
    stale: { pending: number; running: number };
  };
}

interface DatabaseStats {
  activityLogs: number;
  jobs: number;
  backgroundJobs: number;
  userJobs: number;
}

export function DataRetentionSettings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);

  // Database stats
  const [dbStats, setDbStats] = useState<DatabaseStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  // Preview state
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // Quick purge settings
  const [quickPurgeDays, setQuickPurgeDays] = useState(7);
  const [includeBackgroundJobs, setIncludeBackgroundJobs] = useState(true);

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
    fetchDatabaseStats();
  }, []);

  const fetchDatabaseStats = async () => {
    setLoadingStats(true);
    try {
      // Fetch activity logs count
      const { count: logsCount } = await supabase
        .from('idrac_commands')
        .select('*', { count: 'exact', head: true });

      // Fetch jobs count with breakdown
      const { count: totalJobs } = await supabase
        .from('jobs')
        .select('*', { count: 'exact', head: true });

      // Background job types - using or filter to avoid type issues with string array
      const { count: backgroundCount } = await supabase
        .from('jobs')
        .select('*', { count: 'exact', head: true })
        .or('job_type.eq.scheduled_vcenter_sync,job_type.eq.scheduled_replication_check,job_type.eq.rpo_monitoring,job_type.eq.vcenter_sync,job_type.eq.partial_vcenter_sync,job_type.eq.cluster_health_check');

      setDbStats({
        activityLogs: logsCount || 0,
        jobs: totalJobs || 0,
        backgroundJobs: backgroundCount || 0,
        userJobs: (totalJobs || 0) - (backgroundCount || 0)
      });
    } catch (error) {
      console.error('Error fetching database stats:', error);
    } finally {
      setLoadingStats(false);
    }
  };

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

  const handlePreview = async () => {
    setPreviewing(true);
    setPreview(null);
    try {
      const [logsResult, jobsResult] = await Promise.all([
        supabase.functions.invoke('cleanup-activity-logs', {
          body: { preview: true, retentionDays: quickPurgeDays }
        }),
        supabase.functions.invoke('cleanup-old-jobs', {
          body: { preview: true, retentionDays: quickPurgeDays, includeBackgroundJobs }
        })
      ]);

      if (logsResult.error) throw logsResult.error;
      if (jobsResult.error) throw jobsResult.error;

      setPreview({
        activityLogs: logsResult.data?.count || 0,
        jobs: jobsResult.data?.counts || {
          total: 0,
          background: 0,
          user: 0,
          tasks: 0,
          byType: [],
          stale: { pending: 0, running: 0 }
        }
      });
    } catch (error: any) {
      toast({ title: "Preview Error", description: error.message, variant: "destructive" });
    } finally {
      setPreviewing(false);
    }
  };

  const handleCleanupNow = async () => {
    setCleaningUp(true);
    setShowConfirmDialog(false);
    try {
      const [logsResult, jobsResult] = await Promise.all([
        supabase.functions.invoke('cleanup-activity-logs', {
          body: { retentionDays: quickPurgeDays }
        }),
        supabase.functions.invoke('cleanup-old-jobs', {
          body: { retentionDays: quickPurgeDays, includeBackgroundJobs }
        })
      ]);

      if (logsResult.error) throw logsResult.error;
      if (jobsResult.error) throw jobsResult.error;

      const deletedLogs = logsResult.data?.deleted || 0;
      const deletedJobs = jobsResult.data?.deleted?.jobs || 0;
      const deletedTasks = jobsResult.data?.deleted?.tasks || 0;

      toast({ 
        title: "Cleanup Complete", 
        description: `Deleted ${deletedLogs.toLocaleString()} logs, ${deletedJobs.toLocaleString()} jobs, and ${deletedTasks.toLocaleString()} tasks`
      });

      // Refresh data
      setPreview(null);
      loadSettings();
      fetchStaleJobCount();
      fetchDatabaseStats();
    } catch (error: any) {
      toast({ title: "Cleanup Error", description: error.message, variant: "destructive" });
    } finally {
      setCleaningUp(false);
    }
  };

  const formatNumber = (num: number) => num.toLocaleString();

  return (
    <>
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
          {/* Database Statistics Section */}
          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="flex items-center gap-2 mb-3">
              <HardDrive className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Database Statistics</span>
              {loadingStats && <Loader2 className="h-3 w-3 animate-spin" />}
            </div>
            {dbStats && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Activity Logs</p>
                  <p className="font-semibold">{formatNumber(dbStats.activityLogs)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Total Jobs</p>
                  <p className="font-semibold">{formatNumber(dbStats.jobs)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Background Jobs</p>
                  <p className="font-semibold text-muted-foreground">{formatNumber(dbStats.backgroundJobs)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">User Jobs</p>
                  <p className="font-semibold">{formatNumber(dbStats.userJobs)}</p>
                </div>
              </div>
            )}
          </div>

          <Separator />

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

          {/* Quick Purge Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <TrendingDown className="h-4 w-4 text-destructive" />
              Quick Purge
              <Badge variant="outline" className="text-xs">One-time cleanup</Badge>
            </div>

            <p className="text-xs text-muted-foreground">
              Perform an aggressive one-time cleanup. This overrides retention settings temporarily.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-xs">Delete data older than (days)</Label>
                <Input
                  type="number"
                  value={quickPurgeDays}
                  onChange={(e) => {
                    setQuickPurgeDays(parseInt(e.target.value) || 7);
                    setPreview(null);
                  }}
                  min={1}
                  max={365}
                  className="h-8"
                />
              </div>

              <div className="flex items-center justify-between pt-5">
                <Label className="text-xs">Include background/polling jobs</Label>
                <Switch
                  checked={includeBackgroundJobs}
                  onCheckedChange={(v) => {
                    setIncludeBackgroundJobs(v);
                    setPreview(null);
                  }}
                />
              </div>
            </div>

            {/* Preview Results */}
            {preview && (
              <div className="rounded-lg border bg-destructive/5 p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  Records to be deleted
                </div>
                <div className="grid gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Activity Logs:</span>
                    <span className="font-medium">{formatNumber(preview.activityLogs)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Jobs:</span>
                    <span className="font-medium">{formatNumber(preview.jobs.total)}</span>
                  </div>
                  {preview.jobs.byType.length > 0 && (
                    <div className="pl-4 space-y-1 text-xs">
                      {preview.jobs.byType.slice(0, 5).map(({ jobType, count }) => (
                        <div key={jobType} className="flex justify-between text-muted-foreground">
                          <span>{jobType}:</span>
                          <span>{formatNumber(count)}</span>
                        </div>
                      ))}
                      {preview.jobs.byType.length > 5 && (
                        <div className="text-muted-foreground">
                          +{preview.jobs.byType.length - 5} more types...
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Job Tasks:</span>
                    <span className="font-medium">{formatNumber(preview.jobs.tasks)}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handlePreview}
                disabled={previewing}
                size="sm"
              >
                {previewing ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Previewing...
                  </>
                ) : (
                  <>
                    <Eye className="mr-2 h-3.5 w-3.5" />
                    Preview
                  </>
                )}
              </Button>
              <Button
                variant="destructive"
                onClick={() => setShowConfirmDialog(true)}
                disabled={cleaningUp || !preview}
                size="sm"
              >
                {cleaningUp ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Purging...
                  </>
                ) : (
                  <>
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    Purge Data
                  </>
                )}
              </Button>
            </div>
          </div>

          <Separator />

          {/* Save Settings */}
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={loading} size="sm">
              {loading ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Confirm Data Purge
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>You are about to permanently delete:</p>
              {preview && (
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>{formatNumber(preview.activityLogs)}</strong> activity log records</li>
                  <li><strong>{formatNumber(preview.jobs.total)}</strong> job records</li>
                  <li><strong>{formatNumber(preview.jobs.tasks)}</strong> task records</li>
                </ul>
              )}
              <p className="text-destructive font-medium">This action cannot be undone.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCleanupNow}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Records
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
