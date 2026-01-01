import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  Server, 
  Loader2, 
  ChevronDown, 
  CheckCircle2, 
  XCircle, 
  RefreshCw,
  Settings,
  Clock,
  Wifi,
  WifiOff
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

interface OpenManageIntegrationCardProps {
  onSyncTriggered?: () => void;
}

export function OpenManageIntegrationCard({ onSyncTriggered }: OpenManageIntegrationCardProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // OpenManage Settings state
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState(443);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [verifySSL, setVerifySSL] = useState(true);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const { data } = await supabase
      .from('openmanage_settings')
      .select('*')
      .maybeSingle();

    if (data) {
      setSettingsId(data.id);
      setHost(data.host);
      setPort(data.port);
      setUsername(data.username);
      setVerifySSL(data.verify_ssl);
      setSyncEnabled(data.sync_enabled);
      setLastSync(data.last_sync);
      setEnabled(!!data.host);
      setIsOpen(!!data.host);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const settings = {
        host,
        port,
        username,
        password: password || undefined,
        verify_ssl: verifySSL,
        sync_enabled: syncEnabled,
      };

      if (settingsId) {
        await supabase
          .from('openmanage_settings')
          .update(settings)
          .eq('id', settingsId);
      } else {
        const { data } = await supabase
          .from('openmanage_settings')
          .insert([settings])
          .select()
          .single();
        if (data) setSettingsId(data.id);
      }

      toast({
        title: "Settings Saved",
        description: "OpenManage Enterprise configuration updated",
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

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('openmanage-test', {
        body: { host, port, username, password, verify_ssl: verifySSL }
      });
      
      if (error) throw error;
      
      setTestResult({ 
        success: data?.success ?? true, 
        message: data?.message || "Connection successful" 
      });
    } catch (error: any) {
      setTestResult({ 
        success: false, 
        message: error.message || "Connection failed" 
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { error } = await supabase.functions.invoke('openmanage-sync');
      if (error) throw error;

      toast({
        title: "Sync Started",
        description: "OpenManage Enterprise sync initiated",
      });

      onSyncTriggered?.();

      setTimeout(() => {
        loadSettings();
        setSyncing(false);
      }, 3000);
    } catch (error: any) {
      toast({
        title: "Sync Failed",
        description: error.message,
        variant: "destructive",
      });
      setSyncing(false);
    }
  };

  const handleEnableToggle = (checked: boolean) => {
    setEnabled(checked);
    setIsOpen(checked);
    if (!checked) {
      // Clear settings when disabled
      setHost("");
      setPort(443);
      setUsername("");
      setPassword("");
      setVerifySSL(true);
      setSyncEnabled(false);
    }
  };

  const getConnectionStatus = () => {
    if (!host) return { icon: WifiOff, label: "Not Configured", variant: "secondary" as const };
    if (syncEnabled) return { icon: Wifi, label: "Connected", variant: "default" as const };
    return { icon: Settings, label: "Configured", variant: "outline" as const };
  };

  const status = getConnectionStatus();
  const StatusIcon = status.icon;

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-cyan-500/10">
                <Server className="h-5 w-5 text-cyan-500" />
              </div>
              <div>
                <CardTitle className="text-base">OpenManage Enterprise</CardTitle>
                <CardDescription className="text-xs">
                  Sync servers from Dell OpenManage Enterprise
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={status.variant} className="gap-1">
                <StatusIcon className="h-3 w-3" />
                {status.label}
              </Badge>
              <Switch
                checked={enabled}
                onCheckedChange={handleEnableToggle}
              />
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-4 pt-0">
            {/* Connection Details */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>OME Host</Label>
                <Input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="openmanage.example.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Port</Label>
                <Input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(parseInt(e.target.value) || 443)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Username</Label>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Leave blank to keep current"
                />
              </div>
            </div>

            {/* Options */}
            <div className="flex items-center justify-between py-2 border-t border-b">
              <div className="space-y-0.5">
                <Label>Verify SSL Certificate</Label>
                <p className="text-xs text-muted-foreground">Validate server certificate on connection</p>
              </div>
              <Switch
                checked={verifySSL}
                onCheckedChange={setVerifySSL}
              />
            </div>

            <div className="flex items-center justify-between py-2 border-b">
              <div className="space-y-0.5">
                <Label>Enable Auto-Sync</Label>
                <p className="text-xs text-muted-foreground">Automatically sync server inventory</p>
              </div>
              <Switch
                checked={syncEnabled}
                onCheckedChange={setSyncEnabled}
              />
            </div>

            {/* Last Sync Info */}
            {lastSync && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                Last synced {formatDistanceToNow(new Date(lastSync), { addSuffix: true })}
              </div>
            )}

            {/* Test Result */}
            {testResult && (
              <div className={`flex items-center gap-2 p-3 rounded-lg ${
                testResult.success ? 'bg-green-500/10 text-green-700' : 'bg-destructive/10 text-destructive'
              }`}>
                {testResult.success ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                <span className="text-sm">{testResult.message}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2">
              <Button 
                variant="outline" 
                onClick={handleTestConnection}
                disabled={testing || !host || !username}
              >
                {testing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  'Test Connection'
                )}
              </Button>
              <Button 
                variant="outline"
                onClick={handleSync}
                disabled={syncing || !host}
              >
                {syncing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Sync Now
                  </>
                )}
              </Button>
              <Button 
                onClick={handleSave} 
                disabled={loading}
                className="ml-auto"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Settings'
                )}
              </Button>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
