import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface IdmUser {
  id: string;
  email: string;
  full_name: string | null;
  idm_uid: string | null;
  idm_user_dn: string | null;
  idm_source: string | null;
  idm_groups: any;
  idm_disabled: boolean | null;
  idm_title: string | null;
  idm_department: string | null;
  idm_mail: string | null;
  last_idm_sync: string | null;
  created_at: string;
  updated_at: string;
}

export interface IdmUserFilters {
  idmSource?: string;
  role?: string;
  status?: string;
  search?: string;
}

export function useIdmUsers(filters: IdmUserFilters = {}) {
  const [users, setUsers] = useState<IdmUser[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const loadUsers = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('profiles')
        .select('*')
        .not('idm_uid', 'is', null)
        .order('full_name');

      // Apply filters
      if (filters.idmSource && filters.idmSource !== 'all') {
        query = query.eq('idm_source', filters.idmSource);
      }
      if (filters.status === 'active') {
        query = query.or('idm_disabled.is.null,idm_disabled.eq.false');
      } else if (filters.status === 'disabled') {
        query = query.eq('idm_disabled', true);
      }
      if (filters.search) {
        query = query.or(
          `full_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%,idm_uid.ilike.%${filters.search}%`
        );
      }

      const { data, error } = await query;

      if (error) throw error;
      setUsers(data || []);
    } catch (error: any) {
      console.error('Failed to load IDM users:', error);
      toast({
        title: 'Error',
        description: 'Failed to load user directory',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleUserDisabled = async (userId: string, disabled: boolean) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ idm_disabled: disabled })
        .eq('id', userId);

      if (error) throw error;

      toast({
        title: disabled ? 'User Disabled' : 'User Enabled',
        description: `User has been ${disabled ? 'disabled' : 'enabled'}`,
      });

      await loadUsers();
    } catch (error: any) {
      console.error('Failed to toggle user status:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to update user status',
        variant: 'destructive',
      });
    }
  };

  const forceResyncUser = async (userId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Create IDM sync job for specific user
      const { error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'idm_sync_users',
          created_by: user.id,
          status: 'pending',
          details: {
            user_id: userId,
            force_sync: true,
          },
        });

      if (error) throw error;

      toast({
        title: 'Sync Started',
        description: 'User re-sync job has been queued',
      });
    } catch (error: any) {
      console.error('Failed to trigger user sync:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to start sync',
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    loadUsers();
  }, [filters]);

  return {
    users,
    loading,
    loadUsers,
    toggleUserDisabled,
    forceResyncUser,
  };
}
