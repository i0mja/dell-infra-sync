import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface IdmAuthSession {
  id: string;
  user_id: string | null;
  idm_uid: string;
  idm_user_dn: string;
  idm_groups: any;
  mapped_role: 'admin' | 'operator' | 'viewer';
  session_started_at: string | null;
  session_expires_at: string | null;
  last_activity_at: string | null;
  is_active: boolean | null;
  ip_address: string | null;
  user_agent: string | null;
  invalidated_at: string | null;
  invalidation_reason: string | null;
  auth_method: string | null;
}

export function useIdmSessions() {
  const [sessions, setSessions] = useState<IdmAuthSession[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const loadSessions = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('idm_auth_sessions')
        .select('*')
        .order('session_started_at', { ascending: false });

      if (error) throw error;
      setSessions(data || []);
    } catch (error: any) {
      console.error('Failed to load IDM sessions:', error);
      toast({
        title: 'Error',
        description: 'Failed to load active sessions',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const invalidateSession = async (id: string, reason: string) => {
    try {
      const { error } = await supabase
        .from('idm_auth_sessions')
        .update({
          is_active: false,
          invalidated_at: new Date().toISOString(),
          invalidation_reason: reason,
        })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Session Invalidated',
        description: 'User has been logged out',
      });

      await loadSessions();
    } catch (error: any) {
      console.error('Failed to invalidate session:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to invalidate session',
        variant: 'destructive',
      });
    }
  };

  const invalidateUserSessions = async (userId: string, reason: string) => {
    try {
      const { error } = await supabase
        .from('idm_auth_sessions')
        .update({
          is_active: false,
          invalidated_at: new Date().toISOString(),
          invalidation_reason: reason,
        })
        .eq('user_id', userId)
        .eq('is_active', true);

      if (error) throw error;

      toast({
        title: 'Sessions Invalidated',
        description: 'All user sessions have been logged out',
      });

      await loadSessions();
    } catch (error: any) {
      console.error('Failed to invalidate user sessions:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to invalidate sessions',
        variant: 'destructive',
      });
    }
  };

  const cleanupExpiredSessions = async () => {
    try {
      const { error } = await supabase
        .from('idm_auth_sessions')
        .update({
          is_active: false,
          invalidated_at: new Date().toISOString(),
          invalidation_reason: 'Expired - automatic cleanup',
        })
        .eq('is_active', true)
        .lt('session_expires_at', new Date().toISOString());

      if (error) throw error;

      toast({
        title: 'Cleanup Complete',
        description: 'Expired sessions have been removed',
      });

      await loadSessions();
    } catch (error: any) {
      console.error('Failed to cleanup expired sessions:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to cleanup sessions',
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  return {
    sessions,
    loading,
    loadSessions,
    invalidateSession,
    invalidateUserSessions,
    cleanupExpiredSessions,
  };
}
