import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface BreakGlassAdmin {
  id: string;
  email: string;
  full_name: string;
  password_hash: string;
  is_active: boolean | null;
  activated_at: string | null;
  activated_by: string | null;
  activation_reason: string | null;
  deactivated_at: string | null;
  use_count: number | null;
  last_used_at: string | null;
  created_at: string | null;
  created_by: string | null;
}

export function useBreakGlassAdmins() {
  const [admins, setAdmins] = useState<BreakGlassAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const loadAdmins = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('break_glass_admins')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAdmins(data || []);
    } catch (error: any) {
      console.error('Failed to load break-glass admins:', error);
      toast({
        title: 'Error',
        description: 'Failed to load break-glass administrators',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const createAdmin = async (admin: { email: string; full_name: string; password: string }) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Hash the password (simple hash - in production use proper bcrypt)
      const encoder = new TextEncoder();
      const data = encoder.encode(admin.password);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const password_hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      const { error } = await supabase
        .from('break_glass_admins')
        .insert([{
          email: admin.email,
          full_name: admin.full_name,
          password_hash,
          created_by: user.id,
        }]);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Break-glass administrator created',
      });

      await loadAdmins();
    } catch (error: any) {
      console.error('Failed to create break-glass admin:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to create administrator',
        variant: 'destructive',
      });
    }
  };

  const activateAdmin = async (id: string, reason: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('break_glass_admins')
        .update({
          is_active: true,
          activated_at: new Date().toISOString(),
          activated_by: user.id,
          activation_reason: reason,
        })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Break-glass administrator activated',
      });

      await loadAdmins();
    } catch (error: any) {
      console.error('Failed to activate break-glass admin:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to activate administrator',
        variant: 'destructive',
      });
    }
  };

  const deactivateAdmin = async (id: string) => {
    try {
      const { error } = await supabase
        .from('break_glass_admins')
        .update({
          is_active: false,
          deactivated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Break-glass administrator deactivated',
      });

      await loadAdmins();
    } catch (error: any) {
      console.error('Failed to deactivate break-glass admin:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to deactivate administrator',
        variant: 'destructive',
      });
    }
  };

  const deleteAdmin = async (id: string) => {
    try {
      const { error } = await supabase
        .from('break_glass_admins')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Break-glass administrator deleted',
      });

      await loadAdmins();
    } catch (error: any) {
      console.error('Failed to delete break-glass admin:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete administrator',
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    loadAdmins();
  }, []);

  return {
    admins,
    loading,
    loadAdmins,
    createAdmin,
    activateAdmin,
    deactivateAdmin,
    deleteAdmin,
  };
}
