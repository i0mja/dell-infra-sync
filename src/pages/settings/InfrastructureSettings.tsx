import { SettingsSection } from "@/components/settings/SettingsSection";
import { ServerGroupsManagement } from "@/components/settings/ServerGroupsManagement";
import { IsoImageLibrary } from "@/components/settings/IsoImageLibrary";
import { FirmwareLibrary } from "@/components/settings/FirmwareLibrary";
import { ZfsApplianceLibrary } from "@/components/settings/ZfsApplianceLibrary";
import { Briefcase, Disc, Database, Server, HardDrive } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";

export function InfrastructureSettings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

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

  useEffect(() => {
    loadOpenManageSettings();
  }, []);

  const loadOpenManageSettings = async () => {
    const { data } = await supabase
      .from('openmanage_settings')
      .select('*')
      .maybeSingle();

    if (data) {
      setOmeSettingsId(data.id);
      setOmeHost(data.host);
      setOmePort(data.port);
      setOmeUsername(data.username);
      setOmeVerifySSL(data.verify_ssl);
      setOmeSyncEnabled(data.sync_enabled);
      setOmeLastSync(data.last_sync);
    }
  };

  const handleSaveOpenManage = async () => {
    setLoading(true);
    try {
      const settings = {
        host: omeHost,
        port: omePort,
        username: omeUsername,
        password: omePassword || undefined,
        verify_ssl: omeVerifySSL,
        sync_enabled: omeSyncEnabled,
      };

      if (omeSettingsId) {
        await supabase
          .from('openmanage_settings')
          .update(settings)
          .eq('id', omeSettingsId);
      } else {
        const { data } = await supabase
          .from('openmanage_settings')
          .insert([settings])
          .select()
          .single();
        if (data) setOmeSettingsId(data.id);
      }

      toast({
        title: "Success",
        description: "OpenManage settings saved",
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

  const triggerOpenManageSync = async () => {
    setOmeSyncing(true);
    try {
      const { error } = await supabase.functions.invoke('openmanage-sync');
      if (error) throw error;

      toast({
        title: "Sync Started",
        description: "OpenManage Enterprise sync initiated",
      });

      setTimeout(() => {
        loadOpenManageSettings();
        setOmeSyncing(false);
      }, 3000);
    } catch (error: any) {
      toast({
        title: "Sync Failed",
        description: error.message,
        variant: "destructive",
      });
      setOmeSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Server Groups */}
      <SettingsSection
        id="server-groups"
        title="Server Groups"
        description="Organize servers into logical groups"
        icon={Briefcase}
      >
        <ServerGroupsManagement />
      </SettingsSection>

      {/* ZFS Appliance Library */}
      <SettingsSection
        id="appliance-library"
        title="ZFS Appliance Library"
        description="Manage prepared ZFS storage appliances for deployment"
        icon={HardDrive}
      >
        <ZfsApplianceLibrary />
      </SettingsSection>

      {/* ISO Images */}
      <SettingsSection
        id="iso-images"
        title="ISO Image Library"
        description="Manage bootable ISO images for virtual media"
        icon={Disc}
      >
        <IsoImageLibrary />
      </SettingsSection>

      {/* Firmware Library */}
      <SettingsSection
        id="firmware"
        title="Firmware Library"
        description="Store and manage Dell firmware update packages"
        icon={Database}
      >
        <FirmwareLibrary />
      </SettingsSection>

      {/* OpenManage Integration */}
      <SettingsSection
        id="openmanage"
        title="OpenManage Enterprise"
        description="Sync servers from Dell OpenManage Enterprise"
        icon={Server}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>OME Host</Label>
              <Input
                value={omeHost}
                onChange={(e) => setOmeHost(e.target.value)}
                placeholder="openmanage.example.com"
              />
            </div>
            <div className="space-y-2">
              <Label>Port</Label>
              <Input
                type="number"
                value={omePort}
                onChange={(e) => setOmePort(parseInt(e.target.value) || 443)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Username</Label>
            <Input
              value={omeUsername}
              onChange={(e) => setOmeUsername(e.target.value)}
              placeholder="admin"
            />
          </div>
          <div className="space-y-2">
            <Label>Password</Label>
            <Input
              type="password"
              value={omePassword}
              onChange={(e) => setOmePassword(e.target.value)}
              placeholder="Leave blank to keep current"
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Verify SSL Certificate</Label>
            <Switch
              checked={omeVerifySSL}
              onCheckedChange={setOmeVerifySSL}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Enable Auto-Sync</Label>
            <Switch
              checked={omeSyncEnabled}
              onCheckedChange={setOmeSyncEnabled}
            />
          </div>
          {omeLastSync && (
            <p className="text-sm text-muted-foreground">
              Last sync: {new Date(omeLastSync).toLocaleString()}
            </p>
          )}
          <div className="flex gap-2">
            <Button onClick={handleSaveOpenManage} disabled={loading}>
              {loading ? "Saving..." : "Save OME Settings"}
            </Button>
            <Button
              variant="outline"
              onClick={triggerOpenManageSync}
              disabled={omeSyncing || !omeHost}
            >
              {omeSyncing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Syncing...
                </>
              ) : (
                'Sync Now'
              )}
            </Button>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}
