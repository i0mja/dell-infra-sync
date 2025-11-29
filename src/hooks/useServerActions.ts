import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { Server } from "./useServers";

export function useServerActions() {
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

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

      toast({
        title: "Connection test started",
        description: "Testing credentials and connectivity...",
      });

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

          if (job.status === "completed") {
            toast({
              title: "Connection test successful",
              description: "Server is reachable with provided credentials",
            });
          } else {
            const details = job.details as any;
            toast({
              title: "Connection test failed",
              description: details?.error || "Unable to connect to server",
              variant: "destructive",
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
      toast({
        title: "Failed to start connection test",
        description: error.message,
        variant: "destructive",
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

      toast({
        title: "Discovery started",
        description: "Refreshing server information...",
      });

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

          if (job.status === "completed") {
            toast({
              title: "Discovery completed",
              description: "Server information updated",
            });
          } else {
            const details = job.details as any;
            toast({
              title: "Discovery failed",
              description: details?.error || "Failed to refresh server info",
              variant: "destructive",
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
      toast({
        title: "Failed to start discovery",
        description: error.message,
        variant: "destructive",
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

      toast({
        title: "Server removed",
        description: "Server has been removed from inventory",
      });

      queryClient.invalidateQueries({ queryKey: ["servers"] });
    } catch (error: any) {
      toast({
        title: "Error removing server",
        description: error.message,
        variant: "destructive",
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
