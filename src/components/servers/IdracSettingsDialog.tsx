import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, Settings, Clock, Database, Cpu, Activity, HardDrive, Network, FileArchive, RefreshCw, MemoryStick } from "lucide-react";
import { useIdracSettings, IdracFetchOptions } from "@/hooks/useIdracSettings";
import { formatDistanceToNow } from "date-fns";
import type { Server } from "@/hooks/useServers";

interface IdracSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server?: Server;
  isGlobal?: boolean;
  onSyncNow?: () => void;
}

const SYNC_INTERVALS = [
  { value: "5", label: "Every 5 minutes" },
  { value: "15", label: "Every 15 minutes" },
  { value: "30", label: "Every 30 minutes" },
  { value: "60", label: "Every hour" },
  { value: "240", label: "Every 4 hours" },
  { value: "720", label: "Every 12 hours" },
  { value: "1440", label: "Every 24 hours" },
];

const SCP_AGE_THRESHOLDS = [
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
];

const FETCH_OPTIONS = [
  {
    key: "firmware" as const,
    label: "Firmware Versions",
    description: "Fetch current firmware for all components (iDRAC, BIOS, NIC, RAID, etc.)",
    icon: Cpu,
  },
  {
    key: "health" as const,
    label: "Health Status",
    description: "Monitor power state, sensors, fans, temperatures, and overall health",
    icon: Activity,
  },
  {
    key: "bios" as const,
    label: "BIOS Settings",
    description: "Read current BIOS configuration and boot settings",
    icon: Settings,
  },
  {
    key: "storage" as const,
    label: "Storage Configuration",
    description: "Drives, RAID volumes, WWNs for datastore correlation",
    icon: HardDrive,
  },
  {
    key: "nics" as const,
    label: "NIC Information",
    description: "MAC addresses and configuration for all network adapters",
    icon: Network,
  },
  {
    key: "memory" as const,
    label: "Memory/DIMM Information",
    description: "Per-DIMM health, capacity, manufacturer, and slot location",
    icon: MemoryStick,
  },
  {
    key: "scp_backup" as const,
    label: "SCP Configuration Backup",
    description: "Full server configuration profile backup (slower, more data)",
    icon: FileArchive,
  },
];

export function IdracSettingsDialog({
  open,
  onOpenChange,
  server,
  isGlobal = false,
  onSyncNow,
}: IdracSettingsDialogProps) {
  const {
    globalSettings,
    serverSettings,
    loading,
    saving,
    saveGlobalSettings,
    saveServerSettings,
    refresh,
  } = useIdracSettings(server?.id);

  const [fetchOptions, setFetchOptions] = useState<IdracFetchOptions>({
    firmware: true,
    health: true,
    bios: true,
    storage: true,
    nics: true,
    memory: true,
    scp_backup: false,
  });

  const [syncEnabled, setSyncEnabled] = useState(false);
  const [syncInterval, setSyncInterval] = useState("60");
  const [scpMaxAgeDays, setScpMaxAgeDays] = useState("30");
  const [scpOnlyIfStale, setScpOnlyIfStale] = useState(true);
  const [useGlobalDefaults, setUseGlobalDefaults] = useState(true);

  // Refresh settings when dialog opens
  useEffect(() => {
    if (open) {
      refresh();
    }
  }, [open, refresh]);

  // Initialize form state when settings load or dialog opens
  useEffect(() => {
    if (!open || loading) return;

    if (isGlobal && globalSettings) {
      setFetchOptions({
        firmware: globalSettings.fetch_firmware,
        health: globalSettings.fetch_health,
        bios: globalSettings.fetch_bios,
        storage: globalSettings.fetch_storage,
        nics: globalSettings.fetch_nics,
        memory: (globalSettings as any).fetch_memory ?? true,
        scp_backup: globalSettings.fetch_scp_backup,
      });
      setSyncEnabled(globalSettings.auto_sync_enabled);
      setSyncInterval(String(globalSettings.sync_interval_minutes));
      setScpMaxAgeDays(String(globalSettings.scp_backup_max_age_days ?? 30));
      setScpOnlyIfStale(globalSettings.scp_backup_only_if_stale ?? true);
    } else if (server) {
      // Check if server has overrides
      const hasOverrides = serverSettings?.idrac_fetch_options !== null || 
                          serverSettings?.idrac_sync_enabled !== null;
      setUseGlobalDefaults(!hasOverrides);

      if (hasOverrides && serverSettings?.idrac_fetch_options) {
        setFetchOptions(serverSettings.idrac_fetch_options);
        setSyncEnabled(serverSettings.idrac_sync_enabled ?? false);
        setSyncInterval(String(serverSettings.idrac_sync_interval_minutes ?? 60));
      } else if (globalSettings) {
        // Use global settings as defaults directly (avoid unstable function refs)
        setFetchOptions({
          firmware: globalSettings.fetch_firmware,
          health: globalSettings.fetch_health,
          bios: globalSettings.fetch_bios,
          storage: globalSettings.fetch_storage,
          nics: globalSettings.fetch_nics,
          memory: (globalSettings as any).fetch_memory ?? true,
          scp_backup: globalSettings.fetch_scp_backup,
        });
        setSyncEnabled(globalSettings.auto_sync_enabled);
        setSyncInterval(String(globalSettings.sync_interval_minutes));
      }
    }
  }, [open, loading, globalSettings, serverSettings, server, isGlobal]);

  const handleFetchOptionChange = (key: keyof IdracFetchOptions, checked: boolean) => {
    setFetchOptions((prev) => ({ ...prev, [key]: checked }));
  };

  const handleSave = async () => {
    if (isGlobal) {
      await saveGlobalSettings({
        fetch_firmware: fetchOptions.firmware,
        fetch_health: fetchOptions.health,
        fetch_bios: fetchOptions.bios,
        fetch_storage: fetchOptions.storage,
        fetch_nics: fetchOptions.nics,
        fetch_memory: fetchOptions.memory,
        fetch_scp_backup: fetchOptions.scp_backup,
        auto_sync_enabled: syncEnabled,
        sync_interval_minutes: parseInt(syncInterval),
        scp_backup_max_age_days: parseInt(scpMaxAgeDays),
        scp_backup_only_if_stale: scpOnlyIfStale,
      } as any);
    } else if (server) {
      if (useGlobalDefaults) {
        // Clear server-specific overrides
        await saveServerSettings({
          idrac_fetch_options: null,
          idrac_sync_enabled: null,
          idrac_sync_interval_minutes: null,
        });
      } else {
        await saveServerSettings({
          idrac_fetch_options: fetchOptions,
          idrac_sync_enabled: syncEnabled,
          idrac_sync_interval_minutes: parseInt(syncInterval),
        });
      }
    }
    onOpenChange(false);
  };

  const title = isGlobal
    ? "Global iDRAC Settings"
    : `iDRAC Settings - ${server?.hostname || server?.ip_address}`;

  const description = isGlobal
    ? "Configure default data fetching options and auto-sync schedules for all servers"
    : "Configure what data to fetch and sync schedule for this server";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="fetch" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="fetch" className="gap-2">
                <Database className="h-4 w-4" />
                Data to Fetch
              </TabsTrigger>
              <TabsTrigger value="sync" className="gap-2">
                <Clock className="h-4 w-4" />
                Auto-Sync
              </TabsTrigger>
            </TabsList>

            <TabsContent value="fetch" className="space-y-4 mt-4">
              {/* Server-specific: option to use global defaults */}
              {!isGlobal && (
                <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                  <div>
                    <Label className="font-medium">Use Global Defaults</Label>
                    <p className="text-xs text-muted-foreground">
                      Inherit settings from global iDRAC configuration
                    </p>
                  </div>
                  <Switch
                    checked={useGlobalDefaults}
                    onCheckedChange={setUseGlobalDefaults}
                  />
                </div>
              )}

              <div className={!isGlobal && useGlobalDefaults ? "opacity-50 pointer-events-none" : ""}>
                <div className="space-y-3">
                  {FETCH_OPTIONS.map((option) => (
                    <div
                      key={option.key}
                      className="flex items-start gap-3 p-3 border rounded-lg hover:bg-accent/50 transition-colors"
                    >
                      <Checkbox
                        id={option.key}
                        checked={fetchOptions[option.key]}
                        onCheckedChange={(checked) =>
                          handleFetchOptionChange(option.key, checked === true)
                        }
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <option.icon className="h-4 w-4 text-muted-foreground" />
                          <Label
                            htmlFor={option.key}
                            className="font-medium cursor-pointer"
                          >
                            {option.label}
                          </Label>
                          {option.key === "scp_backup" && (
                            <Badge variant="outline" className="text-xs">
                              Slower
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {option.description}
                        </p>
                        {/* SCP backup age threshold - only show when scp_backup is selected */}
                        {option.key === "scp_backup" && fetchOptions.scp_backup && (
                          <div className="mt-3 ml-6 p-3 border rounded-md bg-muted/30 space-y-3">
                            <div className="flex items-center gap-2">
                              <Checkbox
                                id="scp-only-if-stale"
                                checked={scpOnlyIfStale}
                                onCheckedChange={(checked) => setScpOnlyIfStale(checked === true)}
                              />
                              <Label htmlFor="scp-only-if-stale" className="text-xs cursor-pointer">
                                Only backup if older than
                              </Label>
                              <Select 
                                value={scpMaxAgeDays} 
                                onValueChange={setScpMaxAgeDays}
                                disabled={!scpOnlyIfStale}
                              >
                                <SelectTrigger className="w-24 h-7 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {SCP_AGE_THRESHOLDS.map((threshold) => (
                                    <SelectItem key={threshold.value} value={threshold.value}>
                                      {threshold.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {scpOnlyIfStale 
                                ? `SCP backups will only run if the last backup is older than ${scpMaxAgeDays} days`
                                : "SCP backups will run on every sync (may be slow)"}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="sync" className="space-y-4 mt-4">
              {/* Server-specific: option to use global defaults */}
              {!isGlobal && (
                <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                  <div>
                    <Label className="font-medium">Use Global Defaults</Label>
                    <p className="text-xs text-muted-foreground">
                      Inherit sync schedule from global configuration
                    </p>
                  </div>
                  <Switch
                    checked={useGlobalDefaults}
                    onCheckedChange={setUseGlobalDefaults}
                  />
                </div>
              )}

              <div className={!isGlobal && useGlobalDefaults ? "opacity-50 pointer-events-none" : ""}>
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <Label className="font-medium">Enable Auto-Sync</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Automatically sync iDRAC data on a schedule
                    </p>
                  </div>
                  <Switch
                    checked={syncEnabled}
                    onCheckedChange={setSyncEnabled}
                  />
                </div>

                {syncEnabled && (
                  <div className="space-y-4 p-4 border rounded-lg bg-muted/20">
                    <div className="space-y-2">
                      <Label>Sync Interval</Label>
                      <Select value={syncInterval} onValueChange={setSyncInterval}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select interval" />
                        </SelectTrigger>
                        <SelectContent>
                          {SYNC_INTERVALS.map((interval) => (
                            <SelectItem key={interval.value} value={interval.value}>
                              {interval.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {(serverSettings?.next_idrac_sync_at || globalSettings?.next_sync_at) && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>
                          Next sync:{" "}
                          {formatDistanceToNow(
                            new Date(serverSettings?.next_idrac_sync_at || globalSettings?.next_sync_at || ""),
                            { addSuffix: true }
                          )}
                        </span>
                      </div>
                    )}

                    {(serverSettings?.last_idrac_sync || globalSettings?.last_sync_at) && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <RefreshCw className="h-3 w-3" />
                        <span>
                          Last sync:{" "}
                          {formatDistanceToNow(
                            new Date(serverSettings?.last_idrac_sync || globalSettings?.last_sync_at || ""),
                            { addSuffix: true }
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <Separator />

              {onSyncNow && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={onSyncNow}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Sync Now
                </Button>
              )}
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
