import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface IdmGroupMapping {
  id: string;
  idm_group_dn: string;
  idm_group_name: string;
  app_role: 'admin' | 'operator' | 'viewer';
  priority: number | null;
  is_active: boolean | null;
  description: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export function useIdmGroupMappings() {
  const [mappings, setMappings] = useState<IdmGroupMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const loadMappings = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('idm_group_mappings')
        .select('*')
        .order('priority', { ascending: true });

      if (error) throw error;
      setMappings(data || []);
    } catch (error: any) {
      console.error('Failed to load IDM group mappings:', error);
      toast({
        title: 'Error',
        description: 'Failed to load group mappings',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const createMapping = async (mapping: Omit<IdmGroupMapping, 'id' | 'created_at' | 'updated_at'>) => {
    try {
      const { error } = await supabase
        .from('idm_group_mappings')
        .insert([mapping]);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Group mapping created',
      });

      await loadMappings();
    } catch (error: any) {
      console.error('Failed to create group mapping:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to create group mapping',
        variant: 'destructive',
      });
    }
  };

  const updateMapping = async (id: string, updates: Partial<IdmGroupMapping>) => {
    try {
      const { error } = await supabase
        .from('idm_group_mappings')
        .update(updates)
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Group mapping updated',
      });

      await loadMappings();
    } catch (error: any) {
      console.error('Failed to update group mapping:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to update group mapping',
        variant: 'destructive',
      });
    }
  };

  const deleteMapping = async (id: string) => {
    try {
      const { error } = await supabase
        .from('idm_group_mappings')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Group mapping deleted',
      });

      await loadMappings();
    } catch (error: any) {
      console.error('Failed to delete group mapping:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete group mapping',
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    loadMappings();
  }, []);

  return {
    mappings,
    loading,
    loadMappings,
    createMapping,
    updateMapping,
    deleteMapping,
  };
}
