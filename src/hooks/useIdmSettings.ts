import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface IdmSettings {
  id: string;
  auth_mode: 'local_only' | 'idm_primary' | 'idm_fallback';
  server_host: string | null;
  server_port: number | null;
  ldaps_port: number | null;
  use_ldaps: boolean | null;
  require_ldaps: boolean | null;
  verify_certificate: boolean | null;
  base_dn: string | null;
  user_search_base: string | null;
  group_search_base: string | null;
  bind_dn: string | null;
  bind_password_encrypted: string | null;
  ca_certificate: string | null;
  connection_timeout_seconds: number | null;
  max_failed_attempts: number | null;
  lockout_duration_minutes: number | null;
  session_timeout_minutes: number | null;
  failover_behavior: string | null;
  sync_enabled: boolean | null;
  sync_interval_minutes: number | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  trusted_domains: string[] | null;
  ad_dc_host: string | null;
  ad_dc_port: number | null;
  ad_dc_use_ssl: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}

export function useIdmSettings() {
  const [settings, setSettings] = useState<IdmSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const loadSettings = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('idm_settings')
        .select('*')
        .maybeSingle();

      if (error) throw error;
      setSettings(data as IdmSettings | null);
    } catch (error: any) {
      console.error('Failed to load IDM settings:', error);
      toast({
        title: 'Error',
        description: 'Failed to load Identity Provider settings',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async (updates: Partial<IdmSettings>) => {
    setSaving(true);
    try {
      // If bind password is being updated, encrypt it first
      if (updates.bind_password_encrypted && !updates.bind_password_encrypted.startsWith('encrypted:')) {
        // For IDM settings, we need to either update existing or insert first to get an ID
        let idmSettingsId = settings?.id;
        
        // If no existing settings, insert first to get an ID
        if (!idmSettingsId) {
          const { data: newSettings, error: insertError } = await supabase
            .from('idm_settings')
            .insert([{ auth_mode: updates.auth_mode || 'local_only' }])
            .select()
            .single();
          
          if (insertError) throw insertError;
          idmSettingsId = newSettings.id;
        }

        const { data: encryptData, error: encryptError } = await supabase.functions.invoke(
          'encrypt-credentials',
          {
            body: {
              type: 'idm_settings',
              idm_settings_id: idmSettingsId,
              password: updates.bind_password_encrypted,
            },
          }
        );

        if (encryptError) throw encryptError;
        
        // Don't overwrite password field - edge function updates it directly
        delete updates.bind_password_encrypted;
      }

      if (settings?.id) {
        // Update existing
        const { error } = await supabase
          .from('idm_settings')
          .update(updates)
          .eq('id', settings.id);

        if (error) throw error;
      } else {
        // Insert new
        const { error } = await supabase
          .from('idm_settings')
          .insert([updates]);

        if (error) throw error;
      }

      toast({
        title: 'Success',
        description: 'Identity Provider settings saved',
      });

      await loadSettings();
    } catch (error: any) {
      console.error('Failed to save IDM settings:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to save settings',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async (formValues?: {
    server_host: string;
    server_port: number;
    ldaps_port?: number;
    use_ldaps: boolean;
    verify_certificate?: boolean;
    base_dn: string;
    user_search_base?: string;
    group_search_base?: string;
    bind_dn: string;
    bind_password?: string;
    ca_certificate?: string;
    connection_timeout_seconds?: number;
    use_saved_password?: boolean;
  }) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Build details from form values if provided
      const details = formValues ? {
        server_host: formValues.server_host,
        server_port: formValues.server_port,
        ldaps_port: formValues.ldaps_port,
        use_ldaps: formValues.use_ldaps,
        verify_certificate: formValues.verify_certificate,
        base_dn: formValues.base_dn,
        user_search_base: formValues.user_search_base,
        group_search_base: formValues.group_search_base,
        bind_dn: formValues.bind_dn,
        bind_password: formValues.bind_password,
        ca_certificate: formValues.ca_certificate,
        connection_timeout_seconds: formValues.connection_timeout_seconds,
        use_saved_password: formValues.use_saved_password || false,
      } : {};

      const { data: job, error } = await supabase
        .from('jobs')
        .insert([{
          job_type: 'idm_test_connection',
          created_by: user.id,
          status: 'pending',
          target_scope: {},
          details,
        }])
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Testing Connection',
        description: 'IDM connection test started. Check Activity Monitor for results.',
      });

      return job;
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to start connection test',
        variant: 'destructive',
      });
      return null;
    }
  };

  const triggerSync = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: job, error } = await supabase
        .from('jobs')
        .insert([{
          job_type: 'idm_sync_users',
          created_by: user.id,
          status: 'pending',
          target_scope: {},
        }])
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Sync Started',
        description: 'User sync from IDM started. Check Activity Monitor for progress.',
      });

      return job;
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to start sync',
        variant: 'destructive',
      });
      return null;
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  return {
    settings,
    loading,
    saving,
    loadSettings,
    saveSettings,
    testConnection,
    triggerSync,
  };
}
