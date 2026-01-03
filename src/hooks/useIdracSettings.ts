import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface IdracFetchOptions {
  firmware: boolean;
  health: boolean;
  bios: boolean;
  storage: boolean;
  nics: boolean;
  scp_backup: boolean;
}

export interface IdracSettings {
  id: string;
  fetch_firmware: boolean;
  fetch_health: boolean;
  fetch_bios: boolean;
  fetch_storage: boolean;
  fetch_nics: boolean;
  fetch_scp_backup: boolean;
  auto_sync_enabled: boolean;
  sync_interval_minutes: number;
  last_sync_at: string | null;
  next_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServerIdracSettings {
  idrac_sync_enabled: boolean | null;
  idrac_sync_interval_minutes: number | null;
  idrac_fetch_options: IdracFetchOptions | null;
  last_idrac_sync: string | null;
  next_idrac_sync_at: string | null;
}

export function useIdracSettings(serverId?: string) {
  const [globalSettings, setGlobalSettings] = useState<IdracSettings | null>(null);
  const [serverSettings, setServerSettings] = useState<ServerIdracSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      // Load global settings
      const { data: global, error: globalError } = await supabase
        .from("idrac_settings")
        .select("*")
        .limit(1)
        .single();

      if (globalError && globalError.code !== "PGRST116") {
        throw globalError;
      }

      setGlobalSettings(global);

      // Load server-specific settings if serverId provided
      if (serverId) {
        const { data: server, error: serverError } = await supabase
          .from("servers")
          .select("idrac_sync_enabled, idrac_sync_interval_minutes, idrac_fetch_options, last_idrac_sync, next_idrac_sync_at")
          .eq("id", serverId)
          .single();

        if (serverError && serverError.code !== "PGRST116") {
          throw serverError;
        }

        setServerSettings(server ? {
          idrac_sync_enabled: server.idrac_sync_enabled,
          idrac_sync_interval_minutes: server.idrac_sync_interval_minutes,
          idrac_fetch_options: server.idrac_fetch_options as unknown as IdracFetchOptions | null,
          last_idrac_sync: server.last_idrac_sync,
          next_idrac_sync_at: server.next_idrac_sync_at,
        } : null);
      }
    } catch (error: any) {
      console.error("Error loading iDRAC settings:", error);
      toast({
        title: "Failed to load settings",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [serverId, toast]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const saveGlobalSettings = async (updates: Partial<IdracSettings>) => {
    if (!globalSettings?.id) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from("idrac_settings")
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq("id", globalSettings.id);

      if (error) throw error;

      setGlobalSettings((prev) => prev ? { ...prev, ...updates } : prev);

      toast({
        title: "Settings saved",
        description: "iDRAC settings have been updated",
      });
    } catch (error: any) {
      console.error("Error saving iDRAC settings:", error);
      toast({
        title: "Failed to save settings",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const saveServerSettings = async (updates: Partial<ServerIdracSettings>) => {
    if (!serverId) return;

    setSaving(true);
    try {
      // Convert IdracFetchOptions to Json-compatible format
      const dbUpdates: Record<string, unknown> = {};
      if ('idrac_sync_enabled' in updates) {
        dbUpdates.idrac_sync_enabled = updates.idrac_sync_enabled;
      }
      if ('idrac_sync_interval_minutes' in updates) {
        dbUpdates.idrac_sync_interval_minutes = updates.idrac_sync_interval_minutes;
      }
      if ('idrac_fetch_options' in updates) {
        dbUpdates.idrac_fetch_options = updates.idrac_fetch_options ? { ...updates.idrac_fetch_options } : null;
      }

      const { error } = await supabase
        .from("servers")
        .update(dbUpdates)
        .eq("id", serverId);

      if (error) throw error;

      setServerSettings((prev) => prev ? { ...prev, ...updates } : updates as ServerIdracSettings);

      toast({
        title: "Settings saved",
        description: "Server iDRAC settings have been updated",
      });
    } catch (error: any) {
      console.error("Error saving server iDRAC settings:", error);
      toast({
        title: "Failed to save settings",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  // Get effective settings (server overrides global)
  const getEffectiveFetchOptions = (): IdracFetchOptions => {
    if (serverSettings?.idrac_fetch_options) {
      return serverSettings.idrac_fetch_options;
    }
    
    return {
      firmware: globalSettings?.fetch_firmware ?? true,
      health: globalSettings?.fetch_health ?? true,
      bios: globalSettings?.fetch_bios ?? true,
      storage: globalSettings?.fetch_storage ?? true,
      nics: globalSettings?.fetch_nics ?? true,
      scp_backup: globalSettings?.fetch_scp_backup ?? false,
    };
  };

  const getEffectiveSyncSettings = () => {
    return {
      enabled: serverSettings?.idrac_sync_enabled ?? globalSettings?.auto_sync_enabled ?? false,
      interval: serverSettings?.idrac_sync_interval_minutes ?? globalSettings?.sync_interval_minutes ?? 60,
    };
  };

  return {
    globalSettings,
    serverSettings,
    loading,
    saving,
    saveGlobalSettings,
    saveServerSettings,
    getEffectiveFetchOptions,
    getEffectiveSyncSettings,
    refresh: loadSettings,
  };
}
