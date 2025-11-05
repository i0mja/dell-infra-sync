import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTheme } from "next-themes";
import { Moon, Sun, Monitor } from "lucide-react";

export default function Settings() {
  const { user, userRole } = useAuth();
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
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

  // Notification Preferences
  const [notifyOnJobComplete, setNotifyOnJobComplete] = useState(true);
  const [notifyOnJobFailed, setNotifyOnJobFailed] = useState(true);
  const [notifyOnJobStarted, setNotifyOnJobStarted] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase
        .from("notification_settings")
        .select("*")
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setSettingsId(data.id);
        setSmtpHost(data.smtp_host || "");
        setSmtpPort(data.smtp_port || 587);
        setSmtpUser(data.smtp_user || "");
        setSmtpPassword(data.smtp_password || "");
        setSmtpFromEmail(data.smtp_from_email || "");
        setTeamsWebhookUrl(data.teams_webhook_url || "");
        setNotifyOnJobComplete(data.notify_on_job_complete ?? true);
        setNotifyOnJobFailed(data.notify_on_job_failed ?? true);
        setNotifyOnJobStarted(data.notify_on_job_started ?? false);
      }
    } catch (error: any) {
      console.error("Error loading settings:", error);
      toast({
        title: "Error",
        description: "Failed to load notification settings",
        variant: "destructive",
      });
    }
  };

  const handleSaveSettings = async () => {
    if (userRole !== "admin") {
      toast({
        title: "Permission Denied",
        description: "Only admins can modify notification settings",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const settingsData = {
        smtp_host: smtpHost || null,
        smtp_port: smtpPort,
        smtp_user: smtpUser || null,
        smtp_password: smtpPassword || null,
        smtp_from_email: smtpFromEmail || null,
        teams_webhook_url: teamsWebhookUrl || null,
        notify_on_job_complete: notifyOnJobComplete,
        notify_on_job_failed: notifyOnJobFailed,
        notify_on_job_started: notifyOnJobStarted,
      };

      if (settingsId) {
        const { error } = await supabase
          .from("notification_settings")
          .update(settingsData)
          .eq("id", settingsId);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("notification_settings")
          .insert(settingsData)
          .select()
          .single();

        if (error) throw error;
        setSettingsId(data.id);
      }

      toast({
        title: "Success",
        description: "Notification settings saved successfully",
      });
    } catch (error: any) {
      console.error("Error saving settings:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to save notification settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return null;
  }

  if (userRole !== "admin") {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              Only administrators can access settings.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
        <h1 className="text-3xl font-bold mb-6">Settings</h1>

        <Tabs defaultValue="appearance" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="smtp">SMTP Email</TabsTrigger>
            <TabsTrigger value="teams">Microsoft Teams</TabsTrigger>
            <TabsTrigger value="preferences">Preferences</TabsTrigger>
          </TabsList>

          <TabsContent value="appearance">
            <Card>
              <CardHeader>
                <CardTitle>Appearance</CardTitle>
                <CardDescription>
                  Customize how the application looks and feels
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <Label>Theme</Label>
                  <p className="text-sm text-muted-foreground">
                    Choose your preferred color scheme
                  </p>
                  <div className="grid grid-cols-3 gap-4">
                    <Button
                      variant={theme === "light" ? "default" : "outline"}
                      onClick={() => setTheme("light")}
                      className="flex items-center gap-2"
                    >
                      <Sun className="h-4 w-4" />
                      Light
                    </Button>
                    <Button
                      variant={theme === "dark" ? "default" : "outline"}
                      onClick={() => setTheme("dark")}
                      className="flex items-center gap-2"
                    >
                      <Moon className="h-4 w-4" />
                      Dark
                    </Button>
                    <Button
                      variant={theme === "system" ? "default" : "outline"}
                      onClick={() => setTheme("system")}
                      className="flex items-center gap-2"
                    >
                      <Monitor className="h-4 w-4" />
                      System
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="smtp">
            <Card>
              <CardHeader>
                <CardTitle>SMTP Configuration</CardTitle>
                <CardDescription>
                  Configure your SMTP server for email notifications
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="smtp-host">SMTP Host</Label>
                  <Input
                    id="smtp-host"
                    placeholder="smtp.example.com"
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="smtp-port">SMTP Port</Label>
                  <Input
                    id="smtp-port"
                    type="number"
                    placeholder="587"
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(parseInt(e.target.value) || 587)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="smtp-user">SMTP Username</Label>
                  <Input
                    id="smtp-user"
                    placeholder="user@example.com"
                    value={smtpUser}
                    onChange={(e) => setSmtpUser(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="smtp-password">SMTP Password</Label>
                  <Input
                    id="smtp-password"
                    type="password"
                    placeholder="••••••••"
                    value={smtpPassword}
                    onChange={(e) => setSmtpPassword(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="smtp-from">From Email Address</Label>
                  <Input
                    id="smtp-from"
                    type="email"
                    placeholder="notifications@example.com"
                    value={smtpFromEmail}
                    onChange={(e) => setSmtpFromEmail(e.target.value)}
                  />
                </div>

                <Button onClick={handleSaveSettings} disabled={loading}>
                  {loading ? "Saving..." : "Save SMTP Settings"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="teams">
            <Card>
              <CardHeader>
                <CardTitle>Microsoft Teams Integration</CardTitle>
                <CardDescription>
                  Configure Teams webhook for job notifications
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="teams-webhook">Teams Webhook URL</Label>
                  <Input
                    id="teams-webhook"
                    placeholder="https://outlook.office.com/webhook/..."
                    value={teamsWebhookUrl}
                    onChange={(e) => setTeamsWebhookUrl(e.target.value)}
                  />
                  <p className="text-sm text-muted-foreground">
                    Create an Incoming Webhook in your Teams channel to get this URL
                  </p>
                </div>

                <Button onClick={handleSaveSettings} disabled={loading}>
                  {loading ? "Saving..." : "Save Teams Settings"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="preferences">
            <Card>
              <CardHeader>
                <CardTitle>Notification Preferences</CardTitle>
                <CardDescription>
                  Choose which events trigger notifications
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="notify-complete">Job Completed</Label>
                    <p className="text-sm text-muted-foreground">
                      Send notification when jobs complete successfully
                    </p>
                  </div>
                  <Switch
                    id="notify-complete"
                    checked={notifyOnJobComplete}
                    onCheckedChange={setNotifyOnJobComplete}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="notify-failed">Job Failed</Label>
                    <p className="text-sm text-muted-foreground">
                      Send notification when jobs fail
                    </p>
                  </div>
                  <Switch
                    id="notify-failed"
                    checked={notifyOnJobFailed}
                    onCheckedChange={setNotifyOnJobFailed}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="notify-started">Job Started</Label>
                    <p className="text-sm text-muted-foreground">
                      Send notification when jobs start
                    </p>
                  </div>
                  <Switch
                    id="notify-started"
                    checked={notifyOnJobStarted}
                    onCheckedChange={setNotifyOnJobStarted}
                  />
                </div>

                <Button onClick={handleSaveSettings} disabled={loading}>
                  {loading ? "Saving..." : "Save Preferences"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
  );
}