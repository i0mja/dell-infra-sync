import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface VCenter {
  id: string;
  name: string;
  datacenter_location: string | null;
  host: string;
  username: string;
  password_encrypted: string | null;
  port: number;
  verify_ssl: boolean;
  sync_enabled: boolean;
  sync_interval_minutes: number | null;
  last_sync: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  is_primary: boolean | null;
  color: string | null;
  site_code: string | null;
  vm_prefix: string | null;
  default_zfs_template_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface VCenterFormData {
  name: string;
  datacenter_location?: string;
  host: string;
  username: string;
  password: string;
  port: number;
  verify_ssl: boolean;
  sync_enabled: boolean;
  color?: string;
  is_primary?: boolean;
  site_code?: string;
  vm_prefix?: string;
  default_zfs_template_id?: string;
}

export function useVCenters() {
  const { toast } = useToast();
  const [vcenters, setVcenters] = useState<VCenter[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchVCenters = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("vcenters")
        .select("*")
        .order("name");

      if (error) throw error;
      setVcenters(data || []);
    } catch (error: any) {
      console.error("Error fetching vCenters:", error);
      toast({
        title: "Error",
        description: "Failed to load vCenter connections",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Trigger a silent background sync for a vCenter
  const triggerBackgroundSync = async (vcenterId: string, vcenterName: string) => {
    try {
      await supabase.functions.invoke("create-job", {
        body: {
          job_type: "vcenter_sync",
          target_scope: { vcenter_ids: [vcenterId] },
          details: {
            vcenter_id: vcenterId,
            vcenter_name: vcenterName,
            silent: true, // Suppresses toast notifications
            triggered_by: 'vcenter_change',
          },
        },
      });
      console.log(`Background sync triggered for ${vcenterName}`);
    } catch (error) {
      console.error("Error triggering background sync:", error);
      // Don't show toast for background sync failures - it's silent
    }
  };

  const addVCenter = async (data: VCenterFormData): Promise<{ success: boolean; id?: string }> => {
    try {
      // Insert without password first
      const { data: newVCenter, error } = await supabase.from("vcenters").insert([
        {
          name: data.name,
          datacenter_location: data.datacenter_location || null,
          host: data.host,
          username: data.username,
          password_encrypted: null,
          port: data.port,
          verify_ssl: data.verify_ssl,
          sync_enabled: data.sync_enabled,
          color: data.color || "#6366f1",
          is_primary: data.is_primary || false,
          site_code: data.site_code || null,
          vm_prefix: data.vm_prefix || null,
          default_zfs_template_id: data.default_zfs_template_id || null,
        },
      ]).select().single();

      if (error) throw error;

      // Encrypt password via edge function
      const { error: encryptError } = await supabase.functions.invoke('encrypt-credentials', {
        body: {
          type: 'vcenter',
          vcenter_id: newVCenter.id,
          password: data.password,
        }
      });

      if (encryptError) {
        // Clean up if encryption fails
        await supabase.from("vcenters").delete().eq('id', newVCenter.id);
        throw new Error('Failed to encrypt credentials: ' + encryptError.message);
      }

      toast({
        title: "vCenter added",
        description: `${data.name} has been added successfully`,
      });

      await fetchVCenters();
      
      // Trigger silent background sync after successful add
      triggerBackgroundSync(newVCenter.id, data.name);
      
      return { success: true, id: newVCenter.id };
    } catch (error: any) {
      console.error("Error adding vCenter:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to add vCenter connection",
        variant: "destructive",
      });
      return { success: false };
    }
  };

  const updateVCenter = async (id: string, data: Partial<VCenterFormData>) => {
    try {
      const updateData: any = { ...data };
      delete updateData.password; // Remove password from direct update
      
      // Update non-password fields first
      const { error } = await supabase
        .from("vcenters")
        .update(updateData)
        .eq("id", id);

      if (error) throw error;

      // Encrypt password via edge function if provided
      if (data.password) {
        const { error: encryptError } = await supabase.functions.invoke('encrypt-credentials', {
          body: {
            type: 'vcenter',
            vcenter_id: id,
            password: data.password,
          }
        });

        if (encryptError) {
          throw new Error('Failed to encrypt credentials: ' + encryptError.message);
        }
      }

      toast({
        title: "vCenter updated",
        description: "vCenter connection has been updated successfully",
      });

      await fetchVCenters();
      
      // Trigger silent background sync after successful update
      const vcenterName = data.name || vcenters.find(v => v.id === id)?.name || 'vCenter';
      triggerBackgroundSync(id, vcenterName);
      
      return true;
    } catch (error: any) {
      console.error("Error updating vCenter:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to update vCenter connection",
        variant: "destructive",
      });
      return false;
    }
  };

  const deleteVCenter = async (id: string) => {
    try {
      const { error } = await supabase.from("vcenters").delete().eq("id", id);

      if (error) throw error;

      toast({
        title: "vCenter deleted",
        description: "vCenter connection has been deleted successfully",
      });

      await fetchVCenters();
      return true;
    } catch (error: any) {
      console.error("Error deleting vCenter:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete vCenter connection",
        variant: "destructive",
      });
      return false;
    }
  };

  useEffect(() => {
    fetchVCenters();

    // Subscribe to realtime changes
    const channel = supabase
      .channel("vcenters_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "vcenters" }, () => {
        fetchVCenters();
      })
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, []);

  return {
    vcenters,
    loading,
    addVCenter,
    updateVCenter,
    deleteVCenter,
    refetch: fetchVCenters,
  };
}
