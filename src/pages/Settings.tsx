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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

  // OpenManage Settings
  const [omeSettingsId, setOmeSettingsId] = useState<string | null>(null);
  const [omeHost, setOmeHost] = useState("");
  const [omePort, setOmePort] = useState(443);
  const [omeUsername, setOmeUsername] = useState("");
  const [omePassword, setOmePassword] = useState("");
  const [omeVerifySSL, setOmeVerifySSL] = useState(true);
  const [omeSyncEnabled, setOmeSyncEnabled] = useState(false);
  const [omeLastSync, setOmeLastSync] = useState<string | null>(null);
  const [omeSyncing, setOmeSyncing] = useState(false);
  
  // API Token state
  const [apiTokens, setApiTokens] = useState<any[]>([]);
  const [newTokenName, setNewTokenName] = useState("");
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [showTokenDialog, setShowTokenDialog] = useState(false);

  useEffect(() => {
    loadSettings();
    loadApiTokens();
  }, []);

  const loadApiTokens = async () => {
    const { data, error } = await supabase
      .from('api_tokens')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      toast({
        title: "Error loading API tokens",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    
    setApiTokens(data || []);
  };

  const generateApiToken = async () => {
    if (!newTokenName.trim()) {
      toast({
        title: "Token name required",
        description: "Please enter a name for your API token",
        variant: "destructive",
      });
      return;
    }

    // Generate a random token (32 bytes = 64 hex chars)
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = Array.from(tokenBytes, byte => byte.toString(16).padStart(2, '0')).join('');
    
    // Hash the token for storage
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const tokenHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const { error } = await supabase
      .from('api_tokens')
      .insert([{
        user_id: user?.id,
        name: newTokenName,
        token_hash: tokenHash,
      }] as any);

    if (error) {
      toast({
        title: "Error generating token",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    setGeneratedToken(token);
    setShowTokenDialog(true);
    setNewTokenName("");
    loadApiTokens();
    
    toast({
      title: "API token generated",
      description: "Make sure to copy it now, you won't be able to see it again",
    });
  };

  const deleteApiToken = async (tokenId: string) => {
    const { error } = await supabase
      .from('api_tokens')
      .delete()
      .eq('id', tokenId);

    if (error) {
      toast({
        title: "Error deleting token",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    loadApiTokens();
    toast({
      title: "Token deleted",
      description: "The API token has been revoked",
    });
  };

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

    // Load OpenManage settings
    try {
      const { data: omeData, error: omeError } = await supabase
        .from("openmanage_settings")
        .select("*")
        .limit(1)
        .maybeSingle();

      if (omeError) throw omeError;

      if (omeData) {
        setOmeSettingsId(omeData.id);
        setOmeHost(omeData.host || "");
        setOmePort(omeData.port || 443);
        setOmeUsername(omeData.username || "");
        setOmePassword(omeData.password || "");
        setOmeVerifySSL(omeData.verify_ssl ?? true);
        setOmeSyncEnabled(omeData.sync_enabled ?? false);
        setOmeLastSync(omeData.last_sync);
      }
    } catch (error: any) {
      console.error("Error loading OpenManage settings:", error);
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

  const handleSaveOmeSettings = async () => {
    if (userRole !== "admin") {
      toast({
        title: "Permission Denied",
        description: "Only admins can modify OpenManage settings",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const omeData = {
        host: omeHost,
        port: omePort,
        username: omeUsername,
        password: omePassword,
        verify_ssl: omeVerifySSL,
        sync_enabled: omeSyncEnabled,
      };

      if (omeSettingsId) {
        const { error } = await supabase
          .from("openmanage_settings")
          .update(omeData)
          .eq("id", omeSettingsId);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("openmanage_settings")
          .insert(omeData)
          .select()
          .single();

        if (error) throw error;
        setOmeSettingsId(data.id);
      }

      toast({
        title: "Success",
        description: "OpenManage settings saved successfully",
      });
    } catch (error: any) {
      console.error("Error saving OpenManage settings:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to save OpenManage settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSyncNow = async () => {
    if (userRole !== "admin" && userRole !== "operator") {
      toast({
        title: "Permission Denied",
        description: "Only admins and operators can trigger sync",
        variant: "destructive",
      });
      return;
    }

    if (!omeHost || !omeUsername || !omePassword) {
      toast({
        title: "Configuration Required",
        description: "Please configure OpenManage settings first",
        variant: "destructive",
      });
      return;
    }

    setOmeSyncing(true);
    try {
      toast({
        title: "Sync Started",
        description: "OpenManage sync initiated. This may take a few moments...",
      });

      // Note: This requires the openmanage-sync-script.py to be run
      // The edge function expects devices array from the script
      toast({
        title: "Manual Sync Required",
        description: "Please run the openmanage-sync-script.py on your on-premise server to perform the sync. See documentation for details.",
      });
    } catch (error: any) {
      console.error("Error triggering sync:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to trigger sync",
        variant: "destructive",
      });
    } finally {
      setOmeSyncing(false);
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
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="smtp">SMTP Email</TabsTrigger>
            <TabsTrigger value="teams">Microsoft Teams</TabsTrigger>
            <TabsTrigger value="openmanage">OpenManage</TabsTrigger>
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

          <TabsContent value="openmanage">
            <Card>
              <CardHeader>
                <CardTitle>Dell OpenManage Enterprise</CardTitle>
                <CardDescription>
                  Configure automatic server discovery from OpenManage Enterprise
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="ome-host">OpenManage Host</Label>
                  <Input
                    id="ome-host"
                    placeholder="openmanage.example.com"
                    value={omeHost}
                    onChange={(e) => setOmeHost(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ome-port">Port</Label>
                  <Input
                    id="ome-port"
                    type="number"
                    placeholder="443"
                    value={omePort}
                    onChange={(e) => setOmePort(parseInt(e.target.value) || 443)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ome-username">Username</Label>
                  <Input
                    id="ome-username"
                    placeholder="admin"
                    value={omeUsername}
                    onChange={(e) => setOmeUsername(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ome-password">Password</Label>
                  <Input
                    id="ome-password"
                    type="password"
                    placeholder="••••••••"
                    value={omePassword}
                    onChange={(e) => setOmePassword(e.target.value)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="ome-verify-ssl">Verify SSL Certificate</Label>
                    <p className="text-sm text-muted-foreground">
                      Disable for self-signed certificates
                    </p>
                  </div>
                  <Switch
                    id="ome-verify-ssl"
                    checked={omeVerifySSL}
                    onCheckedChange={setOmeVerifySSL}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="ome-sync-enabled">Enable Daily Sync</Label>
                    <p className="text-sm text-muted-foreground">
                      Automatically sync servers daily
                    </p>
                  </div>
                  <Switch
                    id="ome-sync-enabled"
                    checked={omeSyncEnabled}
                    onCheckedChange={setOmeSyncEnabled}
                  />
                </div>

                {omeLastSync && (
                  <div className="text-sm text-muted-foreground">
                    Last sync: {new Date(omeLastSync).toLocaleString()}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button onClick={handleSaveOmeSettings} disabled={loading}>
                    {loading ? "Saving..." : "Save Settings"}
                  </Button>
                  <Button 
                    onClick={handleSyncNow} 
                    disabled={omeSyncing}
                    variant="outline"
                  >
                    {omeSyncing ? "Syncing..." : "Sync Now"}
                  </Button>
                </div>

                <div className="mt-6 border-t pt-6">
                  <h3 className="text-lg font-medium mb-2">API Tokens</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Generate API tokens for authenticating the Python sync script
                  </p>
                  
                  <div className="flex gap-2 mb-4">
                    <Input
                      placeholder="Token name (e.g., 'Production Sync')"
                      value={newTokenName}
                      onChange={(e) => setNewTokenName(e.target.value)}
                    />
                    <Button onClick={generateApiToken}>Generate Token</Button>
                  </div>

                  {apiTokens.length > 0 && (
                    <div className="border rounded-lg">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left p-3 text-sm font-medium">Name</th>
                            <th className="text-left p-3 text-sm font-medium">Created</th>
                            <th className="text-left p-3 text-sm font-medium">Last Used</th>
                            <th className="text-right p-3 text-sm font-medium">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {apiTokens.map((token) => (
                            <tr key={token.id} className="border-b last:border-0">
                              <td className="p-3">{token.name}</td>
                              <td className="p-3 text-sm text-muted-foreground">
                                {new Date(token.created_at).toLocaleDateString()}
                              </td>
                              <td className="p-3 text-sm text-muted-foreground">
                                {token.last_used_at ? new Date(token.last_used_at).toLocaleString() : 'Never'}
                              </td>
                              <td className="p-3 text-right">
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => deleteApiToken(token.id)}
                                >
                                  Revoke
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="mt-4 p-4 bg-muted rounded-lg">
                  <p className="text-sm">
                    <strong>Note:</strong> To perform automated syncs, you need to run the <code>openmanage-sync-script.py</code> on your on-premise server. 
                    See the <a href="/docs/OPENMANAGE_SYNC_GUIDE.md" className="text-primary underline">OpenManage Sync Guide</a> for setup instructions.
                  </p>
                </div>
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

        {/* Token Generation Dialog */}
        <Dialog open={showTokenDialog} onOpenChange={setShowTokenDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>API Token Generated</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm font-mono break-all">{generatedToken}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={() => {
                    navigator.clipboard.writeText(generatedToken || '');
                    toast({ title: "Copied to clipboard" });
                  }}
                >
                  Copy Token
                </Button>
                <Button
                  className="flex-1"
                  variant="outline"
                  onClick={() => {
                    setShowTokenDialog(false);
                    setGeneratedToken(null);
                  }}
                >
                  Close
                </Button>
              </div>
              <p className="text-sm text-destructive">
                ⚠️ Save this token now. You won't be able to see it again!
              </p>
            </div>
          </DialogContent>
        </Dialog>
      </div>
  );
}