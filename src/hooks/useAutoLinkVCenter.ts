import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useAutoLinkVCenter() {
  const [isLinking, setIsLinking] = useState(false);

  const autoLinkSingleServer = async (serverId: string, serviceTag: string | null) => {
    if (!serviceTag) {
      toast.error("Cannot auto-link", {
        description: "Server has no service tag"
      });
      return { success: false };
    }

    try {
      // Find matching vCenter host by serial_number = service_tag that isn't already linked
      const { data: vCenterHost, error: hostError } = await supabase
        .from("vcenter_hosts")
        .select("id, name, cluster")
        .eq("serial_number", serviceTag)
        .is("server_id", null)
        .single();

      if (hostError || !vCenterHost) {
        toast.info("No match found", {
          description: `No unlinked vCenter host found with serial number ${serviceTag}`
        });
        return { success: false };
      }

      // Link them together - update both tables
      const [serverUpdate, hostUpdate] = await Promise.all([
        supabase
          .from("servers")
          .update({ vcenter_host_id: vCenterHost.id })
          .eq("id", serverId),
        supabase
          .from("vcenter_hosts")
          .update({ server_id: serverId })
          .eq("id", vCenterHost.id)
      ]);

      if (serverUpdate.error || hostUpdate.error) {
        throw serverUpdate.error || hostUpdate.error;
      }

      // Create audit log
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("audit_logs").insert({
          user_id: user.id,
          action: "server_vcenter_auto_linked",
          details: {
            server_id: serverId,
            vcenter_host_id: vCenterHost.id,
            vcenter_name: vCenterHost.name,
            cluster: vCenterHost.cluster,
            matched_by: "serial_number"
          }
        });
      }

      toast.success("Auto-linked to vCenter", {
        description: `Linked to ${vCenterHost.name}${vCenterHost.cluster ? ` (${vCenterHost.cluster})` : ""}`
      });
      return { success: true };
    } catch (error) {
      console.error("Auto-link error:", error);
      toast.error("Failed to auto-link", {
        description: error instanceof Error ? error.message : "Unknown error"
      });
      return { success: false };
    }
  };

  const autoLinkBulk = async () => {
    setIsLinking(true);
    try {
      // Get all servers with service tags that aren't linked to vCenter
      const { data: servers, error: serversError } = await supabase
        .from("servers")
        .select("id, service_tag, hostname, ip_address")
        .not("service_tag", "is", null)
        .is("vcenter_host_id", null);

      if (serversError) throw serversError;
      if (!servers || servers.length === 0) {
        toast.info("No servers to link", {
          description: "All servers with service tags are already linked"
        });
        return;
      }

      // Get all unlinked vCenter hosts
      const { data: vCenterHosts, error: hostsError } = await supabase
        .from("vcenter_hosts")
        .select("id, name, cluster, serial_number")
        .not("serial_number", "is", null)
        .is("server_id", null);

      if (hostsError) throw hostsError;
      if (!vCenterHosts || vCenterHosts.length === 0) {
        toast.info("No vCenter hosts available", {
          description: "All vCenter hosts are already linked"
        });
        return;
      }

      // Match servers to vCenter hosts by service_tag = serial_number
      const matches: Array<{ serverId: string; hostId: string; serverName: string; hostName: string }> = [];
      for (const server of servers) {
        const matchingHost = vCenterHosts.find(h => h.serial_number === server.service_tag);
        if (matchingHost) {
          matches.push({
            serverId: server.id,
            hostId: matchingHost.id,
            serverName: server.hostname || server.ip_address,
            hostName: matchingHost.name
          });
        }
      }

      if (matches.length === 0) {
        toast.info("No matches found", {
          description: "No servers could be matched to vCenter hosts by serial number"
        });
        return;
      }

      // Perform bulk linking
      const { data: { user } } = await supabase.auth.getUser();
      
      for (const match of matches) {
        await Promise.all([
          supabase
            .from("servers")
            .update({ vcenter_host_id: match.hostId })
            .eq("id", match.serverId),
          supabase
            .from("vcenter_hosts")
            .update({ server_id: match.serverId })
            .eq("id", match.hostId)
        ]);

        // Log each link
        if (user) {
          await supabase.from("audit_logs").insert({
            user_id: user.id,
            action: "server_vcenter_auto_linked_bulk",
            details: {
              server_id: match.serverId,
              vcenter_host_id: match.hostId,
              server_name: match.serverName,
              vcenter_name: match.hostName
            }
          });
        }
      }

      toast.success("Bulk auto-link complete", {
        description: `Successfully linked ${matches.length} server(s) to vCenter`
      });
    } catch (error) {
      console.error("Bulk auto-link error:", error);
      toast.error("Failed to auto-link servers", {
        description: error instanceof Error ? error.message : "Unknown error"
      });
    } finally {
      setIsLinking(false);
    }
  };

  return {
    autoLinkSingleServer,
    autoLinkBulk,
    isLinking
  };
}
