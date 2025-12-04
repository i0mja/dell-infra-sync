import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Server } from "./useServers";

export function useServerActions() {
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const handleTestConnection = async (server: Server) => {
    setTesting(server.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("create-job", {
        body: {
          job_type: "test_credentials",
          created_by: user.id,
          target_scope: { server_ids: [server.id] },
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Failed to create job");

      // Poll for completion
      const jobId = data.job?.id;
      const pollInterval = setInterval(async () => {
        const { data: job } = await supabase
          .from("jobs")
          .select("*")
          .eq("id", jobId)
          .single();

        if (job?.status === "completed" || job?.status === "failed") {
          clearInterval(pollInterval);
          setTesting(null);
          queryClient.invalidateQueries({ queryKey: ["servers"] });

          if (job.status === "failed") {
            const details = job.details as any;
            toast.error("Connection test failed", {
              description: details?.error || "Unable to connect to server",
            });
          }
        }
      }, 2000);

      setTimeout(() => {
        clearInterval(pollInterval);
        setTesting(null);
      }, 30000);
    } catch (error: any) {
      setTesting(null);
      toast.error("Failed to start connection test", {
        description: error.message,
      });
    }
  };

  const handleRefreshInfo = async (server: Server) => {
    setRefreshing(server.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("create-job", {
        body: {
          job_type: "discovery_scan",
          created_by: user.id,
          target_scope: { server_ids: [server.id] },
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Failed to create job");

      // Poll for completion
      const jobId = data.job?.id;
      const pollInterval = setInterval(async () => {
        const { data: job } = await supabase
          .from("jobs")
          .select("*")
          .eq("id", jobId)
          .single();

        if (job?.status === "completed" || job?.status === "failed") {
          clearInterval(pollInterval);
          setRefreshing(null);
          queryClient.invalidateQueries({ queryKey: ["servers"] });

          if (job.status === "failed") {
            const details = job.details as any;
            toast.error("Discovery failed", {
              description: details?.error || "Failed to refresh server info",
            });
          }
        }
      }, 2000);

      setTimeout(() => {
        clearInterval(pollInterval);
        setRefreshing(null);
      }, 60000);
    } catch (error: any) {
      setRefreshing(null);
      toast.error("Failed to start discovery", {
        description: error.message,
      });
    }
  };

  const handleDeleteServer = async (server: Server) => {
    try {
      // Unlink from vCenter host if linked
      if (server.vcenter_host_id) {
        await supabase
          .from("vcenter_hosts")
          .update({ server_id: null })
          .eq("id", server.vcenter_host_id);
      }

      // Create audit log before deletion
      await supabase.from("audit_logs").insert({
        action: "server_deleted",
        details: {
          server_id: server.id,
          hostname: server.hostname,
          ip_address: server.ip_address,
        },
      });

      // Delete server
      const { error } = await supabase
        .from("servers")
        .delete()
        .eq("id", server.id);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["servers"] });
    } catch (error: any) {
      toast.error("Error removing server", {
        description: error.message,
      });
    }
  };

  return {
    refreshing,
    testing,
    handleTestConnection,
    handleRefreshInfo,
    handleDeleteServer,
  };
}
