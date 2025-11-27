import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface FirmwarePackage {
  id: string;
  filename: string;
  file_size_bytes: number;
  checksum: string | null;
  local_path: string | null;
  served_url: string | null;
  component_type: string;
  dell_version: string;
  dell_package_version: string | null;
  applicable_models: string[] | null;
  criticality: string | null;
  release_date: string | null;
  reboot_required: boolean | null;
  description: string | null;
  tags: string[] | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  upload_status: string;
  upload_progress: number | null;
  last_used_at: string | null;
  use_count: number | null;
}

export function useFirmwarePackages() {
  const queryClient = useQueryClient();

  const { data: firmwarePackages, isLoading, error } = useQuery({
    queryKey: ['firmware_packages'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('firmware_packages')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as FirmwarePackage[];
    },
  });

  const deleteFirmware = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('firmware_packages')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['firmware_packages'] });
      toast.success("Firmware package deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete firmware package: ${error.message}`);
    },
  });

  const updateFirmware = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<FirmwarePackage> }) => {
      const { error } = await supabase
        .from('firmware_packages')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['firmware_packages'] });
      toast.success("Firmware package updated successfully");
    },
    onError: (error: Error) => {
      toast.error(`Failed to update firmware package: ${error.message}`);
    },
  });

  const startUpload = useMutation({
    mutationFn: async (uploadData: {
      filename: string;
      file_size_bytes: number;
      component_type: string;
      dell_version: string;
      applicable_models?: string[];
      criticality?: string;
      reboot_required?: boolean;
      description?: string;
      tags?: string[];
      file_data_base64: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      // Create firmware package record
      const { data: firmwarePackage, error: packageError } = await supabase
        .from('firmware_packages')
        .insert({
          filename: uploadData.filename,
          file_size_bytes: uploadData.file_size_bytes,
          component_type: uploadData.component_type,
          dell_version: uploadData.dell_version,
          applicable_models: uploadData.applicable_models || [],
          criticality: uploadData.criticality || 'Optional',
          reboot_required: uploadData.reboot_required ?? true,
          description: uploadData.description,
          tags: uploadData.tags || [],
          upload_status: 'pending',
          upload_progress: 0,
          created_by: user.id,
        })
        .select()
        .single();

      if (packageError) throw packageError;

      // Create job to upload the firmware file
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'firmware_upload',
          status: 'pending',
          created_by: user.id,
          details: {
            firmware_package_id: firmwarePackage.id,
            filename: uploadData.filename,
            file_data_base64: uploadData.file_data_base64,
          },
        })
        .select()
        .single();

      if (jobError) throw jobError;

      return { firmwarePackage, job };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['firmware_packages'] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      toast.success("Firmware upload started");
    },
    onError: (error: Error) => {
      toast.error(`Failed to start firmware upload: ${error.message}`);
    },
  });

  // Calculate total storage used
  const totalStorageGB = firmwarePackages?.reduce(
    (acc, pkg) => acc + (pkg.file_size_bytes || 0),
    0
  ) / (1024 * 1024 * 1024) || 0;

  return {
    firmwarePackages: firmwarePackages || [],
    isLoading,
    error,
    deleteFirmware,
    updateFirmware,
    startUpload,
    totalStorageGB,
  };
}
