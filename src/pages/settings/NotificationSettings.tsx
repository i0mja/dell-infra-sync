import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { Mail, MessageSquare, Bell, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function NotificationSettings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);

  // SMTP Settings
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpFromEmail, setSmtpFromEmail] = useState("");

  // Teams Settings
  const [teamsWebhookUrl, setTeamsWebhookUrl] = useState("");
  const [testingTeams, setTestingTeams] = useState(false);
  const [teamsMentionUsers, setTeamsMentionUsers] = useState("");
  const [mentionOnCriticalFailures, setMentionOnCriticalFailures] = useState(true);

  // Notification Preferences
  const [notifyOnJobComplete, setNotifyOnJobComplete] = useState(true);
  const [notifyOnJobFailed, setNotifyOnJobFailed] = useState(true);
  const [notifyOnJobStarted, setNotifyOnJobStarted] = useState(false);

  const [recentNotifications, setRecentNotifications] = useState<any[]>([]);

  useEffect(() => {
    loadSettings();
    loadRecentNotifications();
  }, []);

  const loadSettings = async () => {
    const { data } = await supabase
      .from('notification_settings')
      .select('*')
      .maybeSingle();

    if (data) {
      setSettingsId(data.id);
      setSmtpHost(data.smtp_host || "");
      setSmtpPort(data.smtp_port || 587);
      setSmtpUser(data.smtp_user || "");
      setSmtpFromEmail(data.smtp_from_email || "");
      setTeamsWebhookUrl(data.teams_webhook_url || "");
      setTeamsMentionUsers(data.teams_mention_users || "");
      setMentionOnCriticalFailures(data.mention_on_critical_failures ?? true);
      setNotifyOnJobComplete(data.notify_on_job_complete ?? true);
      setNotifyOnJobFailed(data.notify_on_job_failed ?? true);
      setNotifyOnJobStarted(data.notify_on_job_started ?? false);
    }
  };

  const loadRecentNotifications = async () => {
    const { data } = await supabase
      .from('notification_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (data) setRecentNotifications(data);
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const settings = {
        smtp_host: smtpHost,
        smtp_port: smtpPort,
        smtp_user: smtpUser,
        smtp_password: smtpPassword || undefined,
        smtp_from_email: smtpFromEmail,
        teams_webhook_url: teamsWebhookUrl,
        teams_mention_users: teamsMentionUsers,
        mention_on_critical_failures: mentionOnCriticalFailures,
        notify_on_job_complete: notifyOnJobComplete,
        notify_on_job_failed: notifyOnJobFailed,
        notify_on_job_started: notifyOnJobStarted,
      };

      if (settingsId) {
        await supabase
          .from('notification_settings')
          .update(settings)
          .eq('id', settingsId);
      } else {
        const { data } = await supabase
          .from('notification_settings')
          .insert([settings])
          .select()
          .single();
        if (data) setSettingsId(data.id);
      }

      toast({
        title: "Success",
        description: "Notification settings saved",
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

  const testTeamsWebhook = async () => {
    setTestingTeams(true);
    try {
      const { error } = await supabase.functions.invoke('send-notification', {
        body: {
          type: 'teams',
          title: 'Test Notification',
          message: 'This is a test notification from Dell Server Manager',
          severity: 'info',
          isTest: true,
        }
      });

      if (error) throw error;

      toast({
        title: "Test Sent",
        description: "Check your Teams channel for the test message",
      });

      setTimeout(() => loadRecentNotifications(), 2000);
    } catch (error: any) {
      toast({
        title: "Test Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setTestingTeams(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* SMTP Settings */}
      <SettingsSection
        id="smtp"
        title="Email Notifications"
        description="Configure SMTP settings for email alerts"
        icon={Mail}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>SMTP Host</Label>
              <Input
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                placeholder="smtp.gmail.com"
              />
            </div>
            <div className="space-y-2">
              <Label>SMTP Port</Label>
              <Input
                type="number"
                value={smtpPort}
                onChange={(e) => setSmtpPort(parseInt(e.target.value) || 587)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>SMTP User</Label>
            <Input
              value={smtpUser}
              onChange={(e) => setSmtpUser(e.target.value)}
              placeholder="your-email@example.com"
            />
          </div>
          <div className="space-y-2">
            <Label>SMTP Password</Label>
            <Input
              type="password"
              value={smtpPassword}
              onChange={(e) => setSmtpPassword(e.target.value)}
              placeholder="Leave blank to keep current"
            />
          </div>
          <div className="space-y-2">
            <Label>From Email</Label>
            <Input
              value={smtpFromEmail}
              onChange={(e) => setSmtpFromEmail(e.target.value)}
              placeholder="server-alerts@example.com"
            />
          </div>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? "Saving..." : "Save Email Settings"}
          </Button>
        </div>
      </SettingsSection>

      {/* Teams Notifications */}
      <SettingsSection
        id="teams"
        title="Microsoft Teams"
        description="Send notifications to Teams channels"
        icon={MessageSquare}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Teams Webhook URL</Label>
            <Input
              value={teamsWebhookUrl}
              onChange={(e) => setTeamsWebhookUrl(e.target.value)}
              placeholder="https://outlook.office.com/webhook/..."
              type="password"
            />
          </div>
          <div className="space-y-2">
            <Label>Mention Users (Optional)</Label>
            <Input
              value={teamsMentionUsers}
              onChange={(e) => setTeamsMentionUsers(e.target.value)}
              placeholder="user1@domain.com, user2@domain.com"
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated email addresses to mention in critical alerts
            </p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Mention on Critical Failures</Label>
              <p className="text-sm text-muted-foreground">
                Notify mentioned users when critical jobs fail
              </p>
            </div>
            <Switch
              checked={mentionOnCriticalFailures}
              onCheckedChange={setMentionOnCriticalFailures}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={loading}>
              {loading ? "Saving..." : "Save Teams Settings"}
            </Button>
            <Button
              variant="outline"
              onClick={testTeamsWebhook}
              disabled={testingTeams || !teamsWebhookUrl}
            >
              {testingTeams ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Testing...
                </>
              ) : (
                'Test Connection'
              )}
            </Button>
          </div>
        </div>
      </SettingsSection>

      {/* Notification Preferences */}
      <SettingsSection
        id="preferences"
        title="Notification Preferences"
        description="Control when notifications are sent"
        icon={Bell}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Job Completed</Label>
              <p className="text-sm text-muted-foreground">
                Notify when jobs finish successfully
              </p>
            </div>
            <Switch
              checked={notifyOnJobComplete}
              onCheckedChange={setNotifyOnJobComplete}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Job Failed</Label>
              <p className="text-sm text-muted-foreground">
                Notify when jobs fail
              </p>
            </div>
            <Switch
              checked={notifyOnJobFailed}
              onCheckedChange={setNotifyOnJobFailed}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Job Started</Label>
              <p className="text-sm text-muted-foreground">
                Notify when jobs begin (can be noisy)
              </p>
            </div>
            <Switch
              checked={notifyOnJobStarted}
              onCheckedChange={setNotifyOnJobStarted}
            />
          </div>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? "Saving..." : "Save Preferences"}
          </Button>
        </div>
      </SettingsSection>

      {/* Recent Notifications */}
      {recentNotifications.length > 0 && (
        <SettingsSection
          id="recent"
          title="Recent Notifications"
          description="Latest notification delivery attempts"
          icon={Bell}
        >
          <div className="space-y-2">
            {recentNotifications.map((notif) => (
              <Card key={notif.id}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge variant={notif.status === 'delivered' ? 'default' : 'destructive'}>
                          {notif.status}
                        </Badge>
                        <span className="text-sm font-medium">{notif.notification_type}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(notif.created_at).toLocaleString()}
                      </p>
                    </div>
                    {notif.error_message && (
                      <p className="text-xs text-destructive">{notif.error_message}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </SettingsSection>
      )}
    </div>
  );
}
