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

  // Start ISO upload job
  const startUploadMutation = useMutation({
    mutationFn: async ({ filename, fileSize, description, tags, isoData }: {
      filename: string;
      fileSize: number;
      description: string;
      tags: string[];
      isoData: string; // base64 encoded
    }) => {
      if (!user) throw new Error("Not authenticated");

      // Create ISO image record
      const { data: isoRecord, error: isoError } = await supabase
        .from('iso_images')
        .insert({
          filename,
          file_size_bytes: fileSize,
          upload_status: 'uploading',
          upload_progress: 0,
          description,
          tags,
          created_by: user.id,
        })
        .select()
        .single();

      if (isoError) throw isoError;

      // Create upload job
      const { data: jobData, error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'iso_upload',
          status: 'pending',
          created_by: user.id,
          details: {
            iso_image_id: isoRecord.id,
            filename,
            file_size: fileSize,
            iso_data: isoData,
          },
        })
        .select()
        .single();

      if (jobError) throw jobError;

      return { isoImageId: isoRecord.id, jobId: jobData.id };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['iso_images'] });
    },
    onError: (error: any) => {
      toast({
        title: "Upload Failed",
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
    startUpload: startUploadMutation.mutateAsync,
    totalStorageGB,
  };
};
