import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { Database } from '@/integrations/supabase/types';

type AppRole = Database['public']['Enums']['app_role'];

export interface SignedInUser {
  id: string;
  email: string;
  full_name: string | null;
  idm_source: string | null;
  idm_uid: string | null;
  last_idm_sync: string | null;
  idm_disabled: boolean | null;
  created_at: string;
  role: AppRole | null;
}

export interface SignedInUserFilters {
  search?: string;
  source?: 'all' | 'idm' | 'local';
  role?: AppRole | 'all';
}

export function useSignedInUsers(filters: SignedInUserFilters = {}) {
  const [users, setUsers] = useState<SignedInUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch profiles
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, email, full_name, idm_source, idm_uid, last_idm_sync, idm_disabled, created_at')
        .order('created_at', { ascending: false });

      if (profilesError) throw profilesError;

      // Fetch roles
      const { data: roles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role');

      if (rolesError) throw rolesError;

      // Create a map of user_id -> role
      const roleMap = new Map<string, AppRole>();
      roles?.forEach(r => roleMap.set(r.user_id, r.role));

      // Combine data
      let combinedUsers: SignedInUser[] = (profiles || []).map(profile => ({
        ...profile,
        role: roleMap.get(profile.id) || null,
      }));

      // Apply filters
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        combinedUsers = combinedUsers.filter(u =>
          u.email?.toLowerCase().includes(searchLower) ||
          u.full_name?.toLowerCase().includes(searchLower) ||
          u.idm_uid?.toLowerCase().includes(searchLower)
        );
      }

      if (filters.source && filters.source !== 'all') {
        if (filters.source === 'idm') {
          combinedUsers = combinedUsers.filter(u => u.idm_source);
        } else {
          combinedUsers = combinedUsers.filter(u => !u.idm_source);
        }
      }

      if (filters.role && filters.role !== 'all') {
        combinedUsers = combinedUsers.filter(u => u.role === filters.role);
      }

      setUsers(combinedUsers);
    } catch (err) {
      console.error('Error loading users:', err);
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [filters.search, filters.source, filters.role]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const updateUserRole = async (userId: string, newRole: AppRole): Promise<boolean> => {
    try {
      // Check if role exists
      const { data: existingRole } = await supabase
        .from('user_roles')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (existingRole) {
        // Update existing role
        const { error } = await supabase
          .from('user_roles')
          .update({ role: newRole })
          .eq('user_id', userId);

        if (error) throw error;
      } else {
        // Insert new role
        const { error } = await supabase
          .from('user_roles')
          .insert({ user_id: userId, role: newRole });

        if (error) throw error;
      }

      toast.success('User role updated');
      await loadUsers();
      return true;
    } catch (err) {
      console.error('Error updating role:', err);
      toast.error('Failed to update user role');
      return false;
    }
  };

  const deleteUser = async (userId: string): Promise<boolean> => {
    try {
      // Call edge function to delete user (handles auth.users deletion)
      const { error } = await supabase.functions.invoke('delete-user', {
        body: { user_id: userId },
      });

      if (error) throw error;

      toast.success('User deleted successfully');
      await loadUsers();
      return true;
    } catch (err) {
      console.error('Error deleting user:', err);
      toast.error('Failed to delete user');
      return false;
    }
  };

  return {
    users,
    loading,
    error,
    refresh: loadUsers,
    updateUserRole,
    deleteUser,
  };
}
