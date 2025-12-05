import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  RefreshCw,
  Network,
  Globe,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Save,
  Wifi,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logActivityDirect } from "@/hooks/useActivityLog";
import type { Server } from "@/hooks/useServers";

interface IdracNetworkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: Server | null;
}

interface NetworkConfig {
  ipv4: {
    enabled: boolean;
    dhcp_enabled: boolean;
    address: string;
    gateway: string;
    netmask: string;
    dns1: string;
    dns2: string;
    dns_from_dhcp: boolean;
  };
  nic: {
    selection: string;
    speed: string;
    duplex: string;
    mtu: number;
    vlan_enabled: boolean;
    vlan_id: number;
    vlan_priority: number;
  };
  ntp: {
    enabled: boolean;
    server1: string;
    server2: string;
    server3: string;
    timezone: string;
  };
}

export function IdracNetworkDialog({
  open,
  onOpenChange,
  server,
}: IdracNetworkDialogProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<NetworkConfig | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editedConfig, setEditedConfig] = useState<Partial<Record<string, string>>>({});
  const [jobId, setJobId] = useState<string | null>(null);

  // Fetch current network configuration
  const fetchNetworkConfig = async () => {
    if (!server) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-job", {
        body: {
          job_type: "idrac_network_read",
          details: {
            server_id: server.id,
          },
        },
      });

      if (error) throw error;

      const newJobId = data.job_id;
      setJobId(newJobId);
      toast.info("Reading network configuration...");

      // Poll for job completion
      const pollJob = async () => {
        const maxAttempts = 30;
        let attempts = 0;

        while (attempts < maxAttempts) {
          await new Promise((r) => setTimeout(r, 2000));
          attempts++;

          const { data: jobData } = await supabase
            .from("jobs")
            .select("status, details")
            .eq("id", newJobId)
            .single();

          if (jobData?.status === "completed") {
            const details = jobData.details as Record<string, unknown>;
            setConfig({
              ipv4: details.ipv4 as NetworkConfig["ipv4"],
              nic: details.nic as NetworkConfig["nic"],
              ntp: details.ntp as NetworkConfig["ntp"],
            });
            toast.success("Network configuration loaded");
            logActivityDirect('network_config_read', 'server', server.hostname || server.ip_address, {
              server_id: server.id,
              ip_address: server.ip_address
            }, { targetId: server.id, success: true });
            break;
          } else if (jobData?.status === "failed") {
            throw new Error((jobData.details as Record<string, string>)?.error || "Failed to read network config");
          }
        }
      };

      await pollJob();
    } catch (error) {
      console.error("Error fetching network config:", error);
      toast.error("Failed to fetch network configuration");
    } finally {
      setLoading(false);
    }
  };

  // Apply network changes
  const applyChanges = async () => {
    if (!server || Object.keys(editedConfig).length === 0) return;

    // Warn if IP address is being changed
    if (editedConfig["IPv4.1.Address"]) {
      const confirmed = window.confirm(
        "⚠️ WARNING: Changing the IP address will disconnect the current session!\n\n" +
        "The server record will be updated with the new IP address.\n\n" +
        "Are you sure you want to continue?"
      );
      if (!confirmed) return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-job", {
        body: {
          job_type: "idrac_network_write",
          details: {
            server_id: server.id,
            changes: editedConfig,
          },
        },
      });

      if (error) throw error;

      toast.info("Applying network changes...");

      // Poll for job completion
      const newJobId = data.job_id;
      const maxAttempts = 30;
      let attempts = 0;

      while (attempts < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2000));
        attempts++;

        const { data: jobData } = await supabase
          .from("jobs")
          .select("status, details")
          .eq("id", newJobId)
          .single();

        if (jobData?.status === "completed") {
          toast.success("Network settings applied successfully");
          logActivityDirect('network_config_write', 'server', server.hostname || server.ip_address, {
            server_id: server.id,
            changes_applied: Object.keys(editedConfig)
          }, { targetId: server.id, success: true });
          setEditedConfig({});
          setEditMode(false);
          // Refresh the config
          await fetchNetworkConfig();
          break;
        } else if (jobData?.status === "failed") {
          throw new Error((jobData.details as Record<string, string>)?.error || "Failed to apply changes");
        }
      }
    } catch (error) {
      console.error("Error applying changes:", error);
      toast.error("Failed to apply network changes");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (open && server) {
      fetchNetworkConfig();
    }
    if (!open) {
      setConfig(null);
      setEditMode(false);
      setEditedConfig({});
    }
  }, [open, server]);

  const updateField = (key: string, value: string) => {
    setEditedConfig((prev) => ({ ...prev, [key]: value }));
  };

  const hasChanges = Object.keys(editedConfig).length > 0;
  const dnsConfigured = config?.ipv4?.dns1 || config?.ipv4?.dns_from_dhcp;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Network className="h-5 w-5" />
            iDRAC Network Settings
          </DialogTitle>
          <DialogDescription>
            {server?.hostname || server?.ip_address} - View and configure iDRAC network settings
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Reading network configuration...</p>
          </div>
        ) : config ? (
          <Tabs defaultValue="ipv4" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="ipv4" className="flex items-center gap-2">
                <Globe className="h-4 w-4" />
                IPv4 / DNS
              </TabsTrigger>
              <TabsTrigger value="nic" className="flex items-center gap-2">
                <Wifi className="h-4 w-4" />
                NIC
              </TabsTrigger>
              <TabsTrigger value="ntp" className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                NTP
              </TabsTrigger>
            </TabsList>

            <TabsContent value="ipv4" className="space-y-4 mt-4">
              {/* DNS Warning */}
              {!dnsConfigured && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>DNS Not Configured</AlertTitle>
                  <AlertDescription>
                    No DNS servers are configured. Online firmware catalog updates will fail.
                    Configure DNS or use Local Repository for firmware updates.
                  </AlertDescription>
                </Alert>
              )}

              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">IPv4 Configuration</CardTitle>
                    <Badge variant={config.ipv4.dhcp_enabled ? "secondary" : "outline"}>
                      {config.ipv4.dhcp_enabled ? "DHCP" : "Static"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>IP Address</Label>
                      {editMode ? (
                        <Input
                          value={editedConfig["IPv4.1.Address"] ?? config.ipv4.address ?? ""}
                          onChange={(e) => updateField("IPv4.1.Address", e.target.value)}
                          placeholder="192.168.1.100"
                        />
                      ) : (
                        <p className="text-sm font-mono bg-muted px-3 py-2 rounded">
                          {config.ipv4.address || "Not set"}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Netmask</Label>
                      {editMode ? (
                        <Input
                          value={editedConfig["IPv4.1.Netmask"] ?? config.ipv4.netmask ?? ""}
                          onChange={(e) => updateField("IPv4.1.Netmask", e.target.value)}
                          placeholder="255.255.255.0"
                        />
                      ) : (
                        <p className="text-sm font-mono bg-muted px-3 py-2 rounded">
                          {config.ipv4.netmask || "Not set"}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Gateway</Label>
                      {editMode ? (
                        <Input
                          value={editedConfig["IPv4.1.Gateway"] ?? config.ipv4.gateway ?? ""}
                          onChange={(e) => updateField("IPv4.1.Gateway", e.target.value)}
                          placeholder="192.168.1.1"
                        />
                      ) : (
                        <p className="text-sm font-mono bg-muted px-3 py-2 rounded">
                          {config.ipv4.gateway || "Not set"}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        DHCP
                        {editMode && (
                          <Switch
                            checked={
                              editedConfig["IPv4.1.DHCPEnable"] === "Enabled" ||
                              (!editedConfig["IPv4.1.DHCPEnable"] && config.ipv4.dhcp_enabled)
                            }
                            onCheckedChange={(checked) =>
                              updateField("IPv4.1.DHCPEnable", checked ? "Enabled" : "Disabled")
                            }
                          />
                        )}
                      </Label>
                      {!editMode && (
                        <p className="text-sm bg-muted px-3 py-2 rounded">
                          {config.ipv4.dhcp_enabled ? "Enabled" : "Disabled"}
                        </p>
                      )}
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-base font-medium">DNS Servers</Label>
                      {dnsConfigured ? (
                        <Badge variant="secondary" className="gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          Configured
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          Not Configured
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-sm text-muted-foreground">Primary DNS</Label>
                        {editMode ? (
                          <Input
                            value={editedConfig["IPv4.1.DNS1"] ?? config.ipv4.dns1 ?? ""}
                            onChange={(e) => updateField("IPv4.1.DNS1", e.target.value)}
                            placeholder="8.8.8.8"
                          />
                        ) : (
                          <p className="text-sm font-mono bg-muted px-3 py-2 rounded">
                            {config.ipv4.dns1 || "Not set"}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm text-muted-foreground">Secondary DNS</Label>
                        {editMode ? (
                          <Input
                            value={editedConfig["IPv4.1.DNS2"] ?? config.ipv4.dns2 ?? ""}
                            onChange={(e) => updateField("IPv4.1.DNS2", e.target.value)}
                            placeholder="8.8.4.4"
                          />
                        ) : (
                          <p className="text-sm font-mono bg-muted px-3 py-2 rounded">
                            {config.ipv4.dns2 || "Not set"}
                          </p>
                        )}
                      </div>
                    </div>
                    {config.ipv4.dns_from_dhcp && (
                      <p className="text-xs text-muted-foreground">DNS servers obtained from DHCP</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="nic" className="space-y-4 mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">NIC Configuration</CardTitle>
                  <CardDescription>iDRAC network interface settings</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>NIC Selection</Label>
                      {editMode ? (
                        <Select
                          value={editedConfig["NIC.1.Selection"] ?? config.nic.selection ?? ""}
                          onValueChange={(value) => updateField("NIC.1.Selection", value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select NIC" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Dedicated">Dedicated</SelectItem>
                            <SelectItem value="LOM1">LOM1</SelectItem>
                            <SelectItem value="LOM2">LOM2</SelectItem>
                            <SelectItem value="LOM3">LOM3</SelectItem>
                            <SelectItem value="LOM4">LOM4</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="text-sm bg-muted px-3 py-2 rounded">
                          {config.nic.selection || "Not set"}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Speed</Label>
                      <p className="text-sm bg-muted px-3 py-2 rounded">
                        {config.nic.speed || "Auto"}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label>Duplex</Label>
                      <p className="text-sm bg-muted px-3 py-2 rounded">
                        {config.nic.duplex || "Auto"}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label>MTU</Label>
                      <p className="text-sm bg-muted px-3 py-2 rounded">
                        {config.nic.mtu || "1500"}
                      </p>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Label className="text-base font-medium">VLAN Configuration</Label>
                      <Badge variant={config.nic.vlan_enabled ? "secondary" : "outline"}>
                        {config.nic.vlan_enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </div>
                    {editMode && (
                      <div className="flex items-center gap-4">
                        <Label>Enable VLAN</Label>
                        <Switch
                          checked={
                            editedConfig["NIC.1.VLanEnable"] === "Enabled" ||
                            (!editedConfig["NIC.1.VLanEnable"] && config.nic.vlan_enabled)
                          }
                          onCheckedChange={(checked) =>
                            updateField("NIC.1.VLanEnable", checked ? "Enabled" : "Disabled")
                          }
                        />
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-sm text-muted-foreground">VLAN ID</Label>
                        {editMode ? (
                          <Input
                            type="number"
                            min={1}
                            max={4094}
                            value={editedConfig["NIC.1.VLanID"] ?? config.nic.vlan_id ?? ""}
                            onChange={(e) => updateField("NIC.1.VLanID", e.target.value)}
                            placeholder="1-4094"
                          />
                        ) : (
                          <p className="text-sm bg-muted px-3 py-2 rounded">
                            {config.nic.vlan_id || "Not set"}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm text-muted-foreground">VLAN Priority</Label>
                        <p className="text-sm bg-muted px-3 py-2 rounded">
                          {config.nic.vlan_priority ?? "0"}
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="ntp" className="space-y-4 mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">NTP Configuration</CardTitle>
                    <Badge variant={config.ntp.enabled ? "secondary" : "outline"}>
                      {config.ntp.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </div>
                  <CardDescription>Network Time Protocol settings</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {editMode && (
                    <div className="flex items-center gap-4">
                      <Label>Enable NTP</Label>
                      <Switch
                        checked={
                          editedConfig["NTPConfigGroup.1.NTPEnable"] === "Enabled" ||
                          (!editedConfig["NTPConfigGroup.1.NTPEnable"] && config.ntp.enabled)
                        }
                        onCheckedChange={(checked) =>
                          updateField("NTPConfigGroup.1.NTPEnable", checked ? "Enabled" : "Disabled")
                        }
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-4">
                    <div className="space-y-2">
                      <Label>Primary NTP Server</Label>
                      {editMode ? (
                        <Input
                          value={editedConfig["NTPConfigGroup.1.NTP1"] ?? config.ntp.server1 ?? ""}
                          onChange={(e) => updateField("NTPConfigGroup.1.NTP1", e.target.value)}
                          placeholder="time.windows.com"
                        />
                      ) : (
                        <p className="text-sm font-mono bg-muted px-3 py-2 rounded">
                          {config.ntp.server1 || "Not set"}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Secondary NTP Server</Label>
                      {editMode ? (
                        <Input
                          value={editedConfig["NTPConfigGroup.1.NTP2"] ?? config.ntp.server2 ?? ""}
                          onChange={(e) => updateField("NTPConfigGroup.1.NTP2", e.target.value)}
                          placeholder="pool.ntp.org"
                        />
                      ) : (
                        <p className="text-sm font-mono bg-muted px-3 py-2 rounded">
                          {config.ntp.server2 || "Not set"}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Tertiary NTP Server</Label>
                      {editMode ? (
                        <Input
                          value={editedConfig["NTPConfigGroup.1.NTP3"] ?? config.ntp.server3 ?? ""}
                          onChange={(e) => updateField("NTPConfigGroup.1.NTP3", e.target.value)}
                          placeholder="time.nist.gov"
                        />
                      ) : (
                        <p className="text-sm font-mono bg-muted px-3 py-2 rounded">
                          {config.ntp.server3 || "Not set"}
                        </p>
                      )}
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <Label>Timezone</Label>
                    <p className="text-sm bg-muted px-3 py-2 rounded">
                      {config.ntp.timezone || "Not set"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Network className="h-12 w-12 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Click refresh to load network configuration
            </p>
            <Button onClick={fetchNetworkConfig} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Load Configuration
            </Button>
          </div>
        )}

        {/* Edit mode warning */}
        {editMode && hasChanges && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Pending Changes</AlertTitle>
            <AlertDescription>
              You have unsaved changes. Click "Apply Changes" to save them to the iDRAC.
              {editedConfig["IPv4.1.Address"] && (
                <span className="block mt-1 text-destructive font-medium">
                  ⚠️ IP address change will disconnect the current session!
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={fetchNetworkConfig} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          
          {config && (
            <>
              {editMode ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditMode(false);
                      setEditedConfig({});
                    }}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                  <Button onClick={applyChanges} disabled={saving || !hasChanges}>
                    {saving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Apply Changes
                  </Button>
                </>
              ) : (
                <Button onClick={() => setEditMode(true)}>Edit Settings</Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
