import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SearchResult, SearchCategory } from '@/types/global-search';
import { searchSettings } from '@/lib/settings-search-index';
import { searchQuickActions } from '@/lib/quick-actions-index';

const DEBOUNCE_MS = 150;
const MAX_RESULTS_PER_CATEGORY = 5;

interface DatabaseSearchResult {
  id: string;
  category: string;
  title: string;
  subtitle: string | null;
  metadata: Record<string, unknown> | null;
}

export function useGlobalSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const searchDatabase = useCallback(async (searchTerm: string): Promise<SearchResult[]> => {
    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    const dbResults: SearchResult[] = [];
    const term = `%${searchTerm}%`;

    try {
      // Run parallel queries for each category
      const [
        serversRes,
        vmsRes,
        vmCustomAttrsRes,
        hostsRes,
        clustersRes,
        datastoresRes,
        networksRes,
        protectionGroupsRes,
        replicationTargetsRes,
        jobsRes,
        maintenanceRes,
        serverGroupsRes,
        firmwareRes,
        isoRes,
      ] = await Promise.all([
        // Servers
        supabase
          .from('servers')
          .select('id, hostname, ip_address, service_tag, model')
          .or(`hostname.ilike.${term},ip_address.ilike.${term},service_tag.ilike.${term}`)
          .limit(MAX_RESULTS_PER_CATEGORY),
        
        // VMs
        supabase
          .from('vcenter_vms')
          .select('id, name, ip_address, power_state, guest_os')
          .or(`name.ilike.${term},ip_address.ilike.${term}`)
          .limit(MAX_RESULTS_PER_CATEGORY),
        
        // VM Custom Attributes (search by attribute value)
        supabase
          .from('vcenter_vm_custom_attributes')
          .select('vm_id, attribute_key, attribute_value')
          .ilike('attribute_value', term)
          .limit(MAX_RESULTS_PER_CATEGORY * 3),
        
        // Hosts
        supabase
          .from('vcenter_hosts')
          .select('id, name, cluster, esxi_version, status')
          .or(`name.ilike.${term},cluster.ilike.${term}`)
          .limit(MAX_RESULTS_PER_CATEGORY),
        
        // Clusters
        supabase
          .from('vcenter_clusters')
          .select('id, cluster_name, host_count, vm_count')
          .ilike('cluster_name', term)
          .limit(MAX_RESULTS_PER_CATEGORY),
        
        // Datastores
        supabase
          .from('vcenter_datastores')
          .select('id, name, type, capacity_bytes, free_bytes')
          .ilike('name', term)
          .limit(MAX_RESULTS_PER_CATEGORY),
        
        // Networks - also search by VLAN ID
        supabase
          .from('vcenter_networks')
          .select('id, name, vlan_id, network_type, vm_count')
          .or(`name.ilike.${term}${/^\d+$/.test(searchTerm) ? `,vlan_id.eq.${searchTerm}` : ''}`)
          .limit(MAX_RESULTS_PER_CATEGORY),
        
        // Protection Groups
        supabase
          .from('protection_groups')
          .select('id, name, status, priority')
          .ilike('name', term)
          .limit(MAX_RESULTS_PER_CATEGORY),
        
        // Replication Targets
        supabase
          .from('replication_targets')
          .select('id, name, hostname, health_status, target_type')
          .or(`name.ilike.${term},hostname.ilike.${term}`)
          .limit(MAX_RESULTS_PER_CATEGORY),
        
        // Jobs (recent)
        supabase
          .from('jobs')
          .select('id, job_type, status, created_at')
          .ilike('job_type', term)
          .order('created_at', { ascending: false })
          .limit(MAX_RESULTS_PER_CATEGORY),
        
        // Maintenance Windows
        supabase
          .from('maintenance_windows')
          .select('id, title, status, maintenance_type, planned_start')
          .or(`title.ilike.${term},maintenance_type.ilike.${term}`)
          .limit(MAX_RESULTS_PER_CATEGORY),
        
        // Server Groups
        supabase
          .from('server_groups')
          .select('id, name, description, group_type')
          .or(`name.ilike.${term},description.ilike.${term}`)
          .limit(MAX_RESULTS_PER_CATEGORY),
        
        // Firmware Packages
        supabase
          .from('firmware_packages')
          .select('id, filename, component_type, dell_version')
          .or(`filename.ilike.${term},component_type.ilike.${term}`)
          .limit(MAX_RESULTS_PER_CATEGORY),
        
        // ISO Images
        supabase
          .from('iso_images')
          .select('id, filename, description')
          .or(`filename.ilike.${term},description.ilike.${term}`)
          .limit(MAX_RESULTS_PER_CATEGORY),
      ]);

      // Process servers
      if (serversRes.data) {
        serversRes.data.forEach(s => {
          dbResults.push({
            id: s.id,
            category: 'servers',
            title: s.hostname || s.ip_address,
            subtitle: s.model ? `${s.model} • ${s.ip_address}` : s.ip_address,
            path: `/servers?selected=${s.id}`,
            metadata: { service_tag: s.service_tag },
          });
        });
      }

      // Process VMs - track IDs to avoid duplicates from custom attributes
      const seenVmIds = new Set<string>();
      if (vmsRes.data) {
        vmsRes.data.forEach(v => {
          seenVmIds.add(v.id);
          dbResults.push({
            id: v.id,
            category: 'vms',
            title: v.name,
            subtitle: v.ip_address || v.power_state,
            path: `/vcenter?tab=vms&selected=${v.id}`,
            metadata: { power_state: v.power_state, guest_os: v.guest_os },
          });
        });
      }

      // Process VM Custom Attributes - fetch VM details for matches
      if (vmCustomAttrsRes.data && vmCustomAttrsRes.data.length > 0) {
        const vmIdsFromAttrs = vmCustomAttrsRes.data
          .filter((attr): attr is { vm_id: string; attribute_key: string; attribute_value: string | null } => 
            typeof attr.vm_id === 'string' && !seenVmIds.has(attr.vm_id))
          .map(attr => attr.vm_id);
        
        if (vmIdsFromAttrs.length > 0) {
          const uniqueVmIds = [...new Set(vmIdsFromAttrs)] as string[];
          const { data: attrVms } = await supabase
            .from('vcenter_vms')
            .select('id, name, ip_address, power_state, guest_os')
            .in('id', uniqueVmIds);
          
          if (attrVms) {
            const vmMap = new Map(attrVms.map(vm => [vm.id, vm]));
            vmCustomAttrsRes.data.forEach(attr => {
              if (attr.vm_id && !seenVmIds.has(attr.vm_id)) {
                const vm = vmMap.get(attr.vm_id);
                if (vm) {
                  seenVmIds.add(vm.id);
                  dbResults.push({
                    id: vm.id,
                    category: 'vms',
                    title: vm.name,
                    subtitle: `${attr.attribute_key}: ${attr.attribute_value}`,
                    path: `/vcenter?tab=vms&selected=${vm.id}`,
                    metadata: { 
                      power_state: vm.power_state, 
                      guest_os: vm.guest_os,
                      matched_attribute: { key: attr.attribute_key, value: attr.attribute_value }
                    },
                  });
                }
              }
            });
          }
        }
      }

      // Process Hosts
      if (hostsRes.data) {
        hostsRes.data.forEach(h => {
          dbResults.push({
            id: h.id,
            category: 'hosts',
            title: h.name,
            subtitle: h.cluster ? `Cluster: ${h.cluster}` : h.esxi_version,
            path: `/vcenter?tab=hosts&selected=${h.id}`,
            metadata: { status: h.status },
          });
        });
      }

      // Process Clusters
      if (clustersRes.data) {
        clustersRes.data.forEach(c => {
          dbResults.push({
            id: c.id,
            category: 'clusters',
            title: c.cluster_name,
            subtitle: `${c.host_count || 0} hosts • ${c.vm_count || 0} VMs`,
            path: `/vcenter?tab=clusters&selected=${c.id}`,
          });
        });
      }

      // Process Datastores
      if (datastoresRes.data) {
        datastoresRes.data.forEach(d => {
          const usedPercent = d.capacity_bytes && d.free_bytes 
            ? Math.round(((d.capacity_bytes - d.free_bytes) / d.capacity_bytes) * 100)
            : null;
          dbResults.push({
            id: d.id,
            category: 'datastores',
            title: d.name,
            subtitle: usedPercent !== null ? `${d.type || 'Unknown'} • ${usedPercent}% used` : d.type,
            path: `/vcenter?tab=datastores&selected=${d.id}`,
          });
        });
      }

      // Process Networks
      if (networksRes.data) {
        networksRes.data.forEach(n => {
          dbResults.push({
            id: n.id,
            category: 'networks',
            title: n.name,
            subtitle: n.vlan_id ? `VLAN ${n.vlan_id} • ${n.vm_count || 0} VMs` : `${n.network_type || 'Network'}`,
            path: `/vcenter?tab=networks&selected=${n.id}`,
            metadata: { vlan_id: n.vlan_id },
          });
        });
      }

      // Process Protection Groups
      if (protectionGroupsRes.data) {
        protectionGroupsRes.data.forEach(p => {
          dbResults.push({
            id: p.id,
            category: 'protection_groups',
            title: p.name,
            subtitle: `${p.status || 'Unknown'} • ${p.priority || 'Normal'} priority`,
            path: `/vcenter?tab=replication&group=${p.id}`,
          });
        });
      }

      // Process Replication Targets
      if (replicationTargetsRes.data) {
        replicationTargetsRes.data.forEach(r => {
          dbResults.push({
            id: r.id,
            category: 'replication_targets',
            title: r.name,
            subtitle: `${r.hostname} • ${r.health_status || 'Unknown'}`,
            path: `/vcenter?tab=replication&target=${r.id}`,
          });
        });
      }

      // Process Jobs
      if (jobsRes.data) {
        jobsRes.data.forEach(j => {
          const typeLabel = j.job_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          dbResults.push({
            id: j.id,
            category: 'jobs',
            title: typeLabel,
            subtitle: j.status,
            path: `/activity?job=${j.id}`,
            metadata: { status: j.status },
          });
        });
      }

      // Process Maintenance Windows
      if (maintenanceRes.data) {
        maintenanceRes.data.forEach(m => {
          dbResults.push({
            id: m.id,
            category: 'maintenance',
            title: m.title,
            subtitle: `${m.status} • ${m.maintenance_type}`,
            path: `/maintenance-planner?id=${m.id}`,
          });
        });
      }

      // Process Server Groups
      if (serverGroupsRes.data) {
        serverGroupsRes.data.forEach(g => {
          dbResults.push({
            id: g.id,
            category: 'server_groups',
            title: g.name,
            subtitle: g.description || g.group_type,
            path: `/settings?tab=infrastructure&section=server-groups`,
          });
        });
      }

      // Process Firmware
      if (firmwareRes.data) {
        firmwareRes.data.forEach(f => {
          dbResults.push({
            id: f.id,
            category: 'firmware',
            title: f.filename,
            subtitle: `${f.component_type} • ${f.dell_version}`,
            path: `/settings?tab=infrastructure&section=firmware-library`,
          });
        });
      }

      // Process ISO Images
      if (isoRes.data) {
        isoRes.data.forEach(i => {
          dbResults.push({
            id: i.id,
            category: 'iso_images',
            title: i.filename,
            subtitle: i.description || 'ISO Image',
            path: `/settings?tab=infrastructure&section=virtual-media`,
          });
        });
      }

    } catch (err) {
      console.error('Search error:', err);
    }

    return dbResults;
  }, []);

  const executeSearch = useCallback(async (searchTerm: string) => {
    if (searchTerm.length < 2) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Run all searches in parallel
      const [dbResults, settingsResults, quickActionResults] = await Promise.all([
        searchDatabase(searchTerm),
        Promise.resolve(searchSettings(searchTerm)),
        Promise.resolve(searchQuickActions(searchTerm)),
      ]);

      // Combine and deduplicate results
      const allResults = [
        ...quickActionResults,
        ...dbResults,
        ...settingsResults,
      ];

      setResults(allResults);
    } catch (err) {
      console.error('Search failed:', err);
      setError('Search failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [searchDatabase]);

  // Debounced search effect
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (query.length < 2) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    debounceRef.current = setTimeout(() => {
      executeSearch(query);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, executeSearch]);

  const clearSearch = useCallback(() => {
    setQuery('');
    setResults([]);
    setError(null);
  }, []);

  // Group results by category
  const groupedResults = results.reduce<Record<SearchCategory, SearchResult[]>>((acc, result) => {
    if (!acc[result.category]) {
      acc[result.category] = [];
    }
    acc[result.category].push(result);
    return acc;
  }, {} as Record<SearchCategory, SearchResult[]>);

  return {
    query,
    setQuery,
    results,
    groupedResults,
    isLoading,
    error,
    clearSearch,
  };
}
