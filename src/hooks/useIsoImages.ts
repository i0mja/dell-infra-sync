import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useToast } from "./use-toast";

export interface IsoImage {
  id: string;
  filename: string;
  file_size_bytes: number;
  checksum: string | null;
  upload_status: 'pending' | 'uploading' | 'ready' | 'error';
  upload_progress: number;
  local_path: string | null;
  served_url: string | null;
  description: string | null;
  tags: string[];
  last_mounted_at: string | null;
  mount_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const useIsoImages = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch all ISO images
  const { data: isoImages, isLoading, error } = useQuery({
    queryKey: ['iso_images'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('iso_images')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as IsoImage[];
    },
  });

  // Delete ISO image
  const deleteIsoMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('iso_images')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['iso_images'] });
      toast({
        title: "ISO Deleted",
        description: "ISO image has been removed from the library",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Delete Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Update ISO metadata
  const updateIsoMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<IsoImage> }) => {
      const { error } = await supabase
        .from('iso_images')
        .update(updates)
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['iso_images'] });
      toast({
        title: "ISO Updated",
        description: "ISO image metadata has been updated",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Scan local ISO directory
  const scanLocalIsosMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not authenticated");

      // Create scan job
      const { data: jobData, error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'scan_local_isos',
          status: 'pending',
          created_by: user.id,
          details: {},
        })
        .select()
        .single();

      if (jobError) throw jobError;
      
      toast({
        title: "ISO Scan Started",
        description: "Scanning Job Executor for ISO files...",
      });

      return jobData.id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['iso_images'] });
    },
    onError: (error: any) => {
      toast({
        title: "Scan Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Register ISO from URL
  const registerIsoUrlMutation = useMutation({
    mutationFn: async ({ isoUrl, description, tags, downloadLocal }: {
      isoUrl: string;
      description?: string;
      tags?: string[];
      downloadLocal?: boolean;
    }) => {
      if (!user) throw new Error("Not authenticated");

      // Create register job
      const { data: jobData, error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'register_iso_url',
          status: 'pending',
          created_by: user.id,
          details: {
            iso_url: isoUrl,
            description,
            tags: tags || [],
            download_local: downloadLocal || false,
          },
        })
        .select()
        .single();

      if (jobError) throw jobError;

      toast({
        title: "ISO Registration Started",
        description: downloadLocal 
          ? "Downloading and registering ISO..."
          : "Registering ISO from URL...",
      });

      return jobData.id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['iso_images'] });
    },
    onError: (error: any) => {
      toast({
        title: "Registration Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Calculate total storage used
  const totalStorageBytes = isoImages?.reduce((sum, iso) => sum + iso.file_size_bytes, 0) || 0;
  const totalStorageGB = totalStorageBytes / (1024 * 1024 * 1024);

  return {
    isoImages: isoImages || [],
    isLoading,
    error,
    deleteIso: deleteIsoMutation.mutate,
    updateIso: updateIsoMutation.mutate,
    scanLocalIsos: scanLocalIsosMutation.mutateAsync,
    registerIsoUrl: registerIsoUrlMutation.mutateAsync,
    totalStorageGB,
  };
};
