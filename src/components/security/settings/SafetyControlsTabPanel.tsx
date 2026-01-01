import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScheduleFrequencyPicker } from '@/components/ui/schedule-frequency-picker';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Shield, Loader2, CheckCircle2, XCircle, Clock, ChevronDown, Play, Save } from 'lucide-react';

export function SafetyControlsTabPanel() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);

  // Config state
  const [scheduledCheckId, setScheduledCheckId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [frequency, setFrequency] = useState('0 */6 * * *');
  const [checkAllClusters, setCheckAllClusters] = useState(true);
  const [minRequiredHosts, setMinRequiredHosts] = useState(2);
  const [notifyOnUnsafe, setNotifyOnUnsafe] = useState(true);
  const [lastCheck, setLastCheck] = useState<{ last_run_at: string | null; last_status: string | null } | null>(null);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('scheduled_safety_checks')
      .select('*')
      .maybeSingle();

    if (data) {
      setScheduledCheckId(data.id);
      setEnabled(data.enabled || false);
      setFrequency(data.schedule_cron || '0 */6 * * *');
      setCheckAllClusters(data.check_all_clusters ?? true);
      setMinRequiredHosts(data.min_required_hosts || 2);
      setNotifyOnUnsafe(data.notify_on_unsafe ?? true);
      setLastCheck({
        last_run_at: data.last_run_at,
        last_status: data.last_status,
      });
    }
    setLoading(false);
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      const config = {
        enabled,
        schedule_cron: frequency,
        check_all_clusters: checkAllClusters,
        min_required_hosts: minRequiredHosts,
        notify_on_unsafe: notifyOnUnsafe,
      };

      if (scheduledCheckId) {
        await supabase
          .from('scheduled_safety_checks')
          .update(config)
          .eq('id', scheduledCheckId);
      } else {
        const { data } = await supabase
          .from('scheduled_safety_checks')
          .insert([config])
          .select()
          .single();
        if (data) setScheduledCheckId(data.id);
      }

      toast({
        title: "Success",
        description: "Safety check configuration saved",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.functions.invoke('analyze-maintenance-windows', {
        body: { action: 'run_scheduled_checks' }
      });

      if (error) throw error;

      toast({
        title: "Check Started",
        description: "Running cluster safety checks now",
      });

      setTimeout(() => loadConfig(), 3000);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Scheduled Cluster Safety Checks */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5" />
              <div>
                <CardTitle>Scheduled Cluster Safety Checks</CardTitle>
                <CardDescription>
                  Automatically verify cluster health before maintenance operations
                </CardDescription>
              </div>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </CardHeader>

        {enabled && (
          <CardContent className="space-y-6">
            {/* Last Check Status */}
            {lastCheck?.last_run_at && (
              <div className="bg-muted/30 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {lastCheck.last_status === 'completed' ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : lastCheck.last_status === 'failed' ? (
                      <XCircle className="h-5 w-5 text-red-500" />
                    ) : (
                      <Clock className="h-5 w-5 text-muted-foreground" />
                    )}
                    <div>
                      <p className="font-medium">Last Check</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(lastCheck.last_run_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <Badge variant={lastCheck.last_status === 'completed' ? 'default' : 'destructive'}>
                    {lastCheck.last_status || 'Unknown'}
                  </Badge>
                </div>
              </div>
            )}

            {/* Settings Collapsible */}
            <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="w-full justify-between">
                  <span>Schedule Settings</span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${settingsOpen ? 'rotate-180' : ''}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-4">
                {/* Schedule Picker */}
                <div className="space-y-2">
                  <Label>Check Frequency</Label>
                  <ScheduleFrequencyPicker value={frequency} onChange={setFrequency} />
                </div>

                {/* Check All Clusters */}
                <div className="flex items-center justify-between py-2">
                  <div>
                    <Label>Check All Clusters</Label>
                    <p className="text-sm text-muted-foreground">
                      Run safety checks on all registered vCenter clusters
                    </p>
                  </div>
                  <Switch checked={checkAllClusters} onCheckedChange={setCheckAllClusters} />
                </div>

                {/* Min Required Hosts */}
                <div className="space-y-2">
                  <Label>Minimum Required Hosts</Label>
                  <Input
                    type="number"
                    value={minRequiredHosts}
                    onChange={(e) => setMinRequiredHosts(parseInt(e.target.value) || 2)}
                    min={1}
                    className="w-32"
                  />
                  <p className="text-sm text-muted-foreground">
                    Clusters must have at least this many healthy hosts to be considered safe
                  </p>
                </div>

                {/* Notify on Unsafe */}
                <div className="flex items-center justify-between py-2">
                  <div>
                    <Label>Notify on Unsafe Cluster</Label>
                    <p className="text-sm text-muted-foreground">
                      Send notifications when a cluster fails safety checks
                    </p>
                  </div>
                  <Switch checked={notifyOnUnsafe} onCheckedChange={setNotifyOnUnsafe} />
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-4 border-t">
              <Button onClick={saveConfig} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Save Schedule
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={runNow} disabled={running}>
                {running ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Run Check Now
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        )}

        {!enabled && (
          <CardContent>
            <Alert>
              <AlertDescription>
                Enable scheduled checks to automatically verify cluster health before maintenance operations.
              </AlertDescription>
            </Alert>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
