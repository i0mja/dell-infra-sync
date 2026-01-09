import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Server {
  id: string;
  ip_address: string;
  hostname: string | null;
  model: string | null;
  service_tag: string | null;
  manufacturer: string | null;
  product_name: string | null;
  idrac_firmware: string | null;
  bios_version: string | null;
  redfish_version: string | null;
  cpu_count: number | null;
  memory_gb: number | null;
  manager_mac_address: string | null;
  supported_endpoints: any | null;
  discovery_job_id: string | null;
  connection_status: "online" | "offline" | "unknown" | null;
  connection_error: string | null;
  credential_test_status: string | null;
  credential_last_tested: string | null;
  last_connection_test: string | null;
  power_state: string | null;
  overall_health: string | null;
  last_health_check: string | null;
  vcenter_host_id: string | null;
  credential_set_id: string | null;
  last_seen: string | null;
  created_at: string;
  notes: string | null;
  // Enhanced hardware info
  cpu_model: string | null;
  cpu_cores_per_socket: number | null;
  cpu_speed: string | null;
  boot_mode: string | null;
  boot_order: string[] | null;
  secure_boot: string | null;
  virtualization_enabled: boolean | null;
  total_drives: number | null;
  total_storage_tb: number | null;
  // Location/rack info
  datacenter: string | null;
  rack_id: string | null;
  rack_position: string | null;
  row_aisle: string | null;
  room_floor: string | null;
  location_notes: string | null;
}

interface GroupedServers {
  name: string;
  group?: { id: string; name: string; color: string; icon?: string };
  cluster?: string;
  servers: Server[];
  onlineCount: number;
  linkedCount: number;
}

export function useServers(
  searchTerm: string,
  statusFilter: string,
  groupFilter: string
) {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch related data
  const { data: serverGroups } = useQuery({
    queryKey: ["server-groups"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("server_groups")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: groupMemberships } = useQuery({
    queryKey: ["server-group-members"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("server_group_members")
        .select("*, server_groups(*)");
      if (error) throw error;
      return data;
    },
  });

  const { data: vCenterHosts } = useQuery({
    queryKey: ["vcenter-hosts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vcenter_hosts")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch servers
  const fetchServers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("servers")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setServers((data || []) as Server[]);
    } catch (error) {
      console.error("Error fetching servers:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServers();

    // Set up realtime subscription
    const channel = supabase
      .channel("servers-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "servers" },
        () => {
          fetchServers();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Helper to detect incomplete servers
  const isIncompleteServer = (server: Server) => {
    return (
      !server.model ||
      !server.service_tag ||
      !server.idrac_firmware ||
      server.model === "N/A" ||
      server.service_tag === "N/A" ||
      server.idrac_firmware === "N/A"
    );
  };

  // Filter servers
  const filteredServers = useMemo(() => {
    return servers.filter((server) => {
      // Text search filter
      const matchesSearch =
        server.ip_address.toLowerCase().includes(searchTerm.toLowerCase()) ||
        server.hostname?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        server.service_tag?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        server.model?.toLowerCase().includes(searchTerm.toLowerCase());

      // Status filter
      let matchesStatus = true;
      if (statusFilter === "online") {
        matchesStatus = server.connection_status === "online";
      } else if (statusFilter === "offline") {
        matchesStatus = server.connection_status === "offline";
      } else if (statusFilter === "unknown") {
        matchesStatus =
          !server.connection_status || server.connection_status === "unknown";
      } else if (statusFilter === "incomplete") {
        matchesStatus = isIncompleteServer(server);
      } else if (statusFilter === "degraded") {
        // Degraded filter is handled at ServersTable level since it needs hardware issues data
        // Here we just ensure online servers pass through - the table filters them further
        matchesStatus = server.connection_status === "online";
      }

      // Group filter
      let matchesGroup = true;
      if (groupFilter === "ungrouped") {
        const hasGroup = groupMemberships?.some((m) => m.server_id === server.id);
        matchesGroup = !hasGroup;
      } else if (groupFilter.startsWith("cluster:")) {
        const clusterName = groupFilter.replace("cluster:", "");
        const vCenterHost = vCenterHosts?.find(
          (h) => h.id === server.vcenter_host_id
        );
        matchesGroup = vCenterHost?.cluster === clusterName;
      } else if (groupFilter !== "all") {
        const inGroup = groupMemberships?.some(
          (m) => m.server_id === server.id && m.server_group_id === groupFilter
        );
        matchesGroup = inGroup;
      }

      return matchesSearch && matchesStatus && matchesGroup;
    });
  }, [servers, searchTerm, statusFilter, groupFilter, groupMemberships, vCenterHosts]);

  // Organize servers by groups
  const groupedData = useMemo<GroupedServers[]>(() => {
    const grouped: GroupedServers[] = [];

    // Add each manual server group
    serverGroups?.forEach((group) => {
      const groupServers = filteredServers.filter((s) =>
        groupMemberships?.some(
          (m) => m.server_id === s.id && m.server_group_id === group.id
        )
      );
      if (groupServers.length > 0) {
        grouped.push({
          name: group.name,
          group: group,
          servers: groupServers,
          onlineCount: groupServers.filter((s) => s.connection_status === "online")
            .length,
          linkedCount: groupServers.filter((s) => s.vcenter_host_id).length,
        });
      }
    });

    // Add vCenter cluster groups
    const uniqueClusters = new Set<string>();
    vCenterHosts?.forEach((host) => {
      if (host.cluster) uniqueClusters.add(host.cluster);
    });

    uniqueClusters.forEach((clusterName) => {
      const clusterServers = filteredServers.filter((s) => {
        const vCenterHost = vCenterHosts?.find((h) => h.id === s.vcenter_host_id);
        return vCenterHost?.cluster === clusterName;
      });
      if (clusterServers.length > 0) {
        grouped.push({
          name: `${clusterName} (vCenter)`,
          cluster: clusterName,
          servers: clusterServers,
          onlineCount: clusterServers.filter((s) => s.connection_status === "online")
            .length,
          linkedCount: clusterServers.filter((s) => s.vcenter_host_id).length,
        });
      }
    });

    // Add ungrouped servers
    const ungroupedServers = filteredServers.filter((s) => {
      const hasManualGroup = groupMemberships?.some((m) => m.server_id === s.id);
      const vCenterHost = s.vcenter_host_id
        ? vCenterHosts?.find((h) => h.id === s.vcenter_host_id)
        : null;
      const hasVCenterCluster = vCenterHost?.cluster != null;
      return !hasManualGroup && !hasVCenterCluster;
    });

    if (ungroupedServers.length > 0) {
      grouped.push({
        name: "Ungrouped",
        servers: ungroupedServers,
        onlineCount: ungroupedServers.filter((s) => s.connection_status === "online")
          .length,
        linkedCount: ungroupedServers.filter((s) => s.vcenter_host_id).length,
      });
    }

    return grouped;
  }, [filteredServers, serverGroups, groupMemberships, vCenterHosts]);

  // Calculate stats
  const stats = useMemo(() => {
    const totalServers = servers.length;
    const onlineCount = servers.filter((s) => s.connection_status === "online").length;
    const offlineCount = servers.filter((s) => s.connection_status === "offline").length;
    const unknownCount = servers.filter(
      (s) => !s.connection_status || s.connection_status === "unknown"
    ).length;
    const incompleteCount = servers.filter(
      (s) => isIncompleteServer(s) && s.credential_set_id
    ).length;
    const credentialCoverage = servers.filter((s) => s.credential_set_id).length;

    return {
      totalServers,
      onlineCount,
      offlineCount,
      unknownCount,
      incompleteCount,
      credentialCoverage,
    };
  }, [servers]);

  return {
    servers,
    loading,
    filteredServers,
    groupedData,
    stats,
    serverGroups,
    groupMemberships,
    vCenterHosts,
    refetch: fetchServers,
    isIncompleteServer,
  };
}
