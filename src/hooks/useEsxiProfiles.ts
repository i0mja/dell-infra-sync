import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface EsxiUpgradeProfile {
  id: string;
  name: string;
  description: string | null;
  target_version: string;
  bundle_path: string;
  profile_name: string;
  datastore_name: string | null;
  min_source_version: string | null;
  release_date: string | null;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
  created_by: string | null;
}

export function useEsxiProfiles() {
  const queryClient = useQueryClient();

  const { data: profiles, isLoading, error } = useQuery({
    queryKey: ['esxi_upgrade_profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('esxi_upgrade_profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as EsxiUpgradeProfile[];
    },
  });

  const createProfile = useMutation({
    mutationFn: async (profileData: Omit<EsxiUpgradeProfile, 'id' | 'created_at' | 'updated_at' | 'created_by'>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const { data, error } = await supabase
        .from('esxi_upgrade_profiles')
        .insert({
          ...profileData,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['esxi_upgrade_profiles'] });
      toast.success("ESXi profile created successfully");
    },
    onError: (error: Error) => {
      toast.error(`Failed to create ESXi profile: ${error.message}`);
    },
  });

  const updateProfile = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<EsxiUpgradeProfile> }) => {
      const { error } = await supabase
        .from('esxi_upgrade_profiles')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['esxi_upgrade_profiles'] });
      toast.success("ESXi profile updated successfully");
    },
    onError: (error: Error) => {
      toast.error(`Failed to update ESXi profile: ${error.message}`);
    },
  });

  const deleteProfile = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('esxi_upgrade_profiles')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['esxi_upgrade_profiles'] });
      toast.success("ESXi profile deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete ESXi profile: ${error.message}`);
    },
  });

  return {
    profiles: profiles || [],
    isLoading,
    error,
    createProfile,
    updateProfile,
    deleteProfile,
    refetch: () => queryClient.invalidateQueries({ queryKey: ['esxi_upgrade_profiles'] }),
  };
}
