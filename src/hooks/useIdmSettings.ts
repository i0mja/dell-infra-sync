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
        const { data: encryptData, error: encryptError } = await supabase.functions.invoke(
          'encrypt-credentials',
          {
            body: {
              type: 'idm_settings',
              password: updates.bind_password_encrypted,
            },
          }
        );

        if (encryptError) throw encryptError;
        updates.bind_password_encrypted = encryptData.encrypted_password;
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

  const testConnection = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: job, error } = await supabase
        .from('jobs')
        .insert([{
          job_type: 'idm_test_connection',
          created_by: user.id,
          status: 'pending',
          target_scope: {},
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
