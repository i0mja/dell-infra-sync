import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, AlertTriangle, CheckCircle, Info, Calendar } from "lucide-react";
import { format, addHours } from "date-fns";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { getNextExecutions } from "@/lib/cron-utils";

interface CreateMaintenanceWindowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clusters: string[];
  serverGroups?: Array<{ id: string; name: string; }>;
  servers?: Array<{ id: string; hostname?: string | null; ip_address?: string | null; product_name?: string | null; manufacturer?: string | null; }>;
  prefilledData?: {
    start?: Date;
    end?: Date;
    clusters?: string[];
    cluster_ids?: string[];
    serverGroupIds?: string[];
    server_group_ids?: string[];
    server_ids?: string[];
    maintenance_type?: "firmware_update" | "host_maintenance" | "cluster_update" | "full_update" | "safety_check";
    details?: any;
  };
  onSuccess: () => void;
}

export function CreateMaintenanceWindowDialog({
  open,
  onOpenChange,
  clusters,
  serverGroups = [],
  servers = [],
  prefilledData,
  onSuccess
}: CreateMaintenanceWindowDialogProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<{ is_safe: boolean; warnings: string[]; clusters_status?: any[] } | null>(null);
  const [hostSearch, setHostSearch] = useState("");

  const [formData, setFormData] = useState({
    title: prefilledData?.details?.server_name 
      ? `Firmware Update - ${prefilledData.details.server_name}` 
      : prefilledData?.details?.group_name
      ? `Maintenance - ${prefilledData.details.group_name}`
      : "",
    description: prefilledData?.details?.server_name 
      ? `Scheduled firmware update for server ${prefilledData.details.server_name}` 
      : prefilledData?.details?.group_name
      ? `Scheduled maintenance for ${prefilledData.details.group_name}`
      : "",
    cluster_ids: prefilledData?.clusters || prefilledData?.cluster_ids || [],
    server_group_ids: prefilledData?.serverGroupIds || prefilledData?.server_group_ids || [],
    server_ids: prefilledData?.server_ids || [],
    planned_start: prefilledData?.start ? format(prefilledData.start, "yyyy-MM-dd'T'HH:mm") : format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    planned_end: prefilledData?.end ? format(prefilledData.end, "yyyy-MM-dd'T'HH:mm") : format(addHours(new Date(), 4), "yyyy-MM-dd'T'HH:mm"),
    maintenance_type: prefilledData?.maintenance_type || "firmware_update" as "firmware_update" | "host_maintenance" | "cluster_update" | "full_update" | "safety_check",
    update_scope: "full_stack" as "firmware_only" | "bios_only" | "full_stack" | "safety_check",
    notify_before_hours: 24,
    auto_execute: true,
    firmware_uri: "",
    component: "BIOS",
    recurrence_enabled: false,
    recurrence_type: "monthly" as "monthly" | "quarterly" | "semi_annually" | "yearly" | "custom",
    recurrence_pattern: "0 2 1 * *" // Default: 1st of month at 2 AM
  });

  const hasClusterSelection = formData.cluster_ids.length > 0;
  const filteredHosts = servers.filter(server => {
    const search = hostSearch.toLowerCase();
    if (!search) return true;
    const hostname = server.hostname?.toLowerCase() || "";
    const ip = server.ip_address?.toLowerCase() || "";
    const product = server.product_name?.toLowerCase() || "";
    return hostname.includes(search) || ip.includes(search) || product.includes(search);
  });

  const validateWindow = async () => {
    if (formData.cluster_ids.length === 0 && formData.server_group_ids.length === 0 && formData.server_ids.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please select at least one cluster, server group, or server",
        variant: "destructive"
      });
      return;
    }

    setValidating(true);
    try {
      const warnings: string[] = [];
      let allSafe = true;

      // Validate clusters if selected
      if (formData.cluster_ids.length > 0) {
        const { data: clusterChecks, error: clusterError } = await supabase
          .from('cluster_safety_checks')
          .select('*')
          .in('cluster_id', formData.cluster_ids)
          .gte('check_timestamp', new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
          .order('check_timestamp', { ascending: false });

        if (clusterError) throw clusterError;

        const latestByCluster = new Map();
        for (const check of clusterChecks || []) {
          if (!latestByCluster.has(check.cluster_id)) {
            latestByCluster.set(check.cluster_id, check);
          }
        }

        const allClustersSafe = formData.cluster_ids.every(clusterId => {
          const check = latestByCluster.get(clusterId);
          return check && check.safe_to_proceed;
        });

        const missingClusterChecks = formData.cluster_ids.filter(c => !latestByCluster.has(c));
        
        if (!allClustersSafe) {
          warnings.push('Some clusters may not be safe for maintenance');
          allSafe = false;
        }
        
        if (missingClusterChecks.length > 0) {
          warnings.push(`No recent safety checks for clusters: ${missingClusterChecks.join(', ')}`);
          allSafe = false;
        }
      }

      // Validate server groups if selected
      if (formData.server_group_ids.length > 0) {
        const { data: groupChecks, error: groupError } = await supabase
          .from('server_group_safety_checks')
          .select('*')
          .in('server_group_id', formData.server_group_ids)
          .gte('check_timestamp', new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
          .order('check_timestamp', { ascending: false });

        if (groupError) throw groupError;

        const latestByGroup = new Map();
        for (const check of groupChecks || []) {
          if (!latestByGroup.has(check.server_group_id)) {
            latestByGroup.set(check.server_group_id, check);
          }
        }

        const allGroupsSafe = formData.server_group_ids.every(groupId => {
          const check = latestByGroup.get(groupId);
          return check && check.safe_to_proceed;
        });

        const missingGroupChecks = formData.server_group_ids.filter(g => !latestByGroup.has(g));
        
        if (!allGroupsSafe) {
          warnings.push('Some server groups may not be safe for maintenance');
          allSafe = false;
        }
        
        if (missingGroupChecks.length > 0) {
          const groupNames = missingGroupChecks
            .map(id => serverGroups?.find(g => g.id === id)?.name || id)
            .join(', ');
          warnings.push(`No recent safety checks for server groups: ${groupNames}`);
          allSafe = false;
        }
      }

      setValidation({
        is_safe: allSafe,
        warnings
      });

      toast({
        title: allSafe ? "Validation Successful" : "Validation Warnings",
        description: allSafe ? "All clusters are safe for maintenance" : warnings[0],
        variant: allSafe ? "default" : "destructive"
      });

    } catch (error: any) {
      toast({
        title: "Validation Failed",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = async () => {
    if (!formData.title.trim()) {
      toast({
        title: "Validation Error",
        description: "Please enter a title",
        variant: "destructive"
      });
      return;
    }

    if (formData.cluster_ids.length === 0 && formData.server_group_ids.length === 0 && formData.server_ids.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please select at least one cluster, server group, or host",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Prepare details object with job-specific configuration
      const details: any = {};
      
      // If clusters are selected, include update_scope for orchestration
      if (hasClusterSelection) {
        details.update_scope = formData.update_scope;
      }
      
      // Add firmware-specific fields if applicable (for standalone servers)
      if (formData.maintenance_type === 'firmware_update' && formData.firmware_uri) {
        details.firmware_uri = formData.firmware_uri;
        details.component = formData.component;
      }

      const { error } = await supabase
        .from('maintenance_windows')
        .insert({
          title: formData.title,
          description: formData.description || null,
          cluster_ids: formData.cluster_ids.length > 0 ? formData.cluster_ids : null,
          server_group_ids: formData.server_group_ids.length > 0 ? formData.server_group_ids : null,
          server_ids: formData.server_ids.length > 0 ? formData.server_ids : null,
          planned_start: new Date(formData.planned_start).toISOString(),
          planned_end: new Date(formData.planned_end).toISOString(),
          maintenance_type: formData.maintenance_type,
          notify_before_hours: formData.notify_before_hours,
          created_by: user.id,
          safety_check_snapshot: validation || null,
          status: 'planned',
          auto_execute: formData.auto_execute,
          details: Object.keys(details).length > 0 ? details : null
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: formData.auto_execute 
          ? "Maintenance window created. Jobs will execute automatically at start time."
          : "Maintenance window created successfully",
      });

      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Schedule Maintenance Window</DialogTitle>
          <DialogDescription>
            Plan a maintenance window for your clusters. We'll validate cluster safety before scheduling.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Q1 Firmware Update"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Update all Dell servers to latest firmware..."
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="planned_start">Start Time *</Label>
              <Input
                id="planned_start"
                type="datetime-local"
                value={formData.planned_start}
                onChange={(e) => setFormData({ ...formData, planned_start: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="planned_end">End Time *</Label>
              <Input
                id="planned_end"
                type="datetime-local"
                value={formData.planned_end}
                onChange={(e) => setFormData({ ...formData, planned_end: e.target.value })}
              />
            </div>
          </div>

          {/* Cluster-aware mode vs Standalone mode */}
          {hasClusterSelection ? (
            <>
              {/* CLUSTER MODE: Show orchestration info + update scope */}
              <Alert className="mb-4">
                <Info className="h-4 w-4" />
                <AlertDescription>
                  vCenter clusters selected. Updates will be performed <strong>one server at a time</strong> with automatic orchestration (VM evacuation, maintenance mode, health checks).
                </AlertDescription>
              </Alert>
              
              <div className="space-y-2">
                <Label htmlFor="update_scope">Update Scope *</Label>
                <Select
                  value={formData.update_scope}
                  onValueChange={(value: any) => setFormData({ ...formData, update_scope: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="firmware_only">
                      <div className="space-y-1">
                        <div className="font-medium">Firmware Only</div>
                        <div className="text-xs text-muted-foreground">
                          Update iDRAC and component firmware (safe, no reboot required)
                        </div>
                      </div>
                    </SelectItem>
                    
                    <SelectItem value="bios_only">
                      <div className="space-y-1">
                        <div className="font-medium">BIOS Only</div>
                        <div className="text-xs text-muted-foreground">
                          Update system BIOS (requires reboot)
                        </div>
                      </div>
                    </SelectItem>
                    
                    <SelectItem value="full_stack">
                      <div className="space-y-1">
                        <div className="font-medium">Complete Update</div>
                        <div className="text-xs text-muted-foreground">
                          Update all components (BIOS + firmware + RAID + NIC)
                        </div>
                      </div>
                    </SelectItem>
                    
                    <SelectItem value="safety_check">
                      <div className="space-y-1">
                        <div className="font-medium">Safety Check Only</div>
                        <div className="text-xs text-muted-foreground">
                          Validate cluster health (read-only, no changes)
                        </div>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                
                {/* Contextual helper text */}
                {formData.update_scope === 'firmware_only' && (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Info className="h-4 w-4" />
                    Firmware updates typically don't require reboots
                  </p>
                )}
                {formData.update_scope === 'bios_only' && (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Info className="h-4 w-4" />
                    BIOS updates require server reboot
                  </p>
                )}
                {formData.update_scope === 'full_stack' && (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Info className="h-4 w-4" />
                    Complete update includes BIOS, iDRAC, RAID, NIC, and all components
                  </p>
                )}
                {formData.update_scope === 'safety_check' && (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Info className="h-4 w-4" />
                    Read-only validation - no updates will be performed
                  </p>
                )}
              </div>
              
              {/* Show orchestration settings (read-only) */}
              <div className="space-y-2">
                <Label>Orchestration Settings</Label>
                <div className="space-y-3 p-3 border rounded-md bg-muted/50">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Sequential updates</span>
                    <Badge variant="outline" className="bg-green-500/10 text-green-700">Automatic</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">VM evacuation</span>
                    <Badge variant="outline" className="bg-green-500/10 text-green-700">Automatic</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Maintenance mode</span>
                    <Badge variant="outline" className="bg-green-500/10 text-green-700">Automatic</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Health verification</span>
                    <Badge variant="outline" className="bg-green-500/10 text-green-700">Automatic</Badge>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* STANDALONE MODE: Show traditional maintenance type dropdown */}
              <div className="space-y-2">
                <Label htmlFor="maintenance_type">Maintenance Type *</Label>
                <Select
                  value={formData.maintenance_type}
                  onValueChange={(value: any) => setFormData({ ...formData, maintenance_type: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="firmware_update">
                      <div className="space-y-1">
                        <div className="font-medium">Firmware Update</div>
                        <div className="text-xs text-muted-foreground">
                          Updates iDRAC, BIOS, or component firmware on selected servers
                        </div>
                      </div>
                    </SelectItem>
                    
                    <SelectItem value="host_maintenance">
                      <div className="space-y-1">
                        <div className="font-medium">Host Maintenance</div>
                        <div className="text-xs text-muted-foreground">
                          Prepares hosts for updates (evacuates VMs, enters maintenance mode)
                        </div>
                      </div>
                    </SelectItem>
                    
                    <SelectItem value="cluster_update">
                      <div className="space-y-1">
                        <div className="font-medium">Rolling Cluster Update</div>
                        <div className="text-xs text-muted-foreground">
                          Updates entire cluster one host at a time (orchestrated workflow)
                        </div>
                      </div>
                    </SelectItem>
                    
                    <SelectItem value="full_update">
                      <div className="space-y-1">
                        <div className="font-medium">Full Server Update</div>
                        <div className="text-xs text-muted-foreground">
                          Complete server refresh (firmware + BIOS + all components)
                        </div>
                      </div>
                    </SelectItem>
                    
                    <SelectItem value="safety_check">
                      <div className="space-y-1">
                        <div className="font-medium">Safety Check</div>
                        <div className="text-xs text-muted-foreground">
                          Validates cluster health and readiness (no changes made)
                        </div>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                
                {/* Contextual helper text for standalone mode */}
                {formData.maintenance_type === 'firmware_update' && (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Info className="h-4 w-4" />
                    You'll need to provide a firmware URI in the details below
                  </p>
                )}
                {formData.maintenance_type === 'host_maintenance' && (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Info className="h-4 w-4" />
                    This will evacuate VMs and enter maintenance mode before updates
                  </p>
                )}
                {formData.maintenance_type === 'cluster_update' && (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Info className="h-4 w-4" />
                    Servers will be updated one at a time to maintain cluster availability
                  </p>
                )}
                {formData.maintenance_type === 'full_update' && (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Info className="h-4 w-4" />
                    Complete update includes BIOS, iDRAC, RAID, NIC, and all components
                  </p>
                )}
                {formData.maintenance_type === 'safety_check' && (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Info className="h-4 w-4" />
                    Read-only check - validates health without making changes
                  </p>
                )}
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label>Clusters * ({formData.cluster_ids.length} selected)</Label>
            <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto p-2 border rounded-md">
              {clusters.map(cluster => (
                <label key={cluster} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.cluster_ids.includes(cluster)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setFormData({ ...formData, cluster_ids: [...formData.cluster_ids, cluster] });
                      } else {
                        setFormData({ ...formData, cluster_ids: formData.cluster_ids.filter(c => c !== cluster) });
                      }
                      setValidation(null); // Reset validation when clusters change
                    }}
                    className="rounded"
                  />
                  <span className="text-sm">{cluster}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Server Groups */}
          {serverGroups && serverGroups.length > 0 && (
            <div className="space-y-2">
              <Label>Server Groups (Optional) ({formData.server_group_ids.length} selected)</Label>
              <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto p-2 border rounded-md">
                {serverGroups.map(group => (
                  <label key={group.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.server_group_ids.includes(group.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setFormData({ 
                            ...formData, 
                            server_group_ids: [...formData.server_group_ids, group.id] 
                          });
                        } else {
                          setFormData({ 
                            ...formData, 
                            server_group_ids: formData.server_group_ids.filter(id => id !== group.id) 
                          });
                        }
                        setValidation(null);
                      }}
                      className="rounded"
                    />
                    <span className="text-sm">{group.name}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Server groups can be used alongside or instead of vCenter clusters
              </p>
            </div>
          )}

          {/* Dell Hosts */}
          {servers && servers.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Dell Hosts (Optional) ({formData.server_ids.length} selected)</Label>
                <Input
                  placeholder="Search hosts..."
                  value={hostSearch}
                  onChange={(e) => setHostSearch(e.target.value)}
                  className="h-8 w-48"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto p-2 border rounded-md">
                {filteredHosts.map(server => {
                  const subtitle = server.product_name || server.ip_address;
                  return (
                    <label key={server.id} className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.server_ids.includes(server.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFormData({
                              ...formData,
                              server_ids: [...formData.server_ids, server.id]
                            });
                          } else {
                            setFormData({
                              ...formData,
                              server_ids: formData.server_ids.filter(id => id !== server.id)
                            });
                          }
                          setValidation(null);
                        }}
                        className="rounded mt-1"
                      />
                      <div className="text-sm leading-tight">
                        <div className="font-medium">{server.hostname || server.ip_address || 'Unknown Host'}</div>
                        {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
                      </div>
                    </label>
                  );
                })}
                {filteredHosts.length === 0 && (
                  <div className="col-span-2 text-sm text-muted-foreground text-center py-2">
                    No hosts match your search.
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Select individual Dell hosts for targeted maintenance tasks
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="notify_before">Notification (hours before)</Label>
            <Input
              id="notify_before"
              type="number"
              min="1"
              max="168"
              value={formData.notify_before_hours}
              onChange={(e) => setFormData({ ...formData, notify_before_hours: parseInt(e.target.value) })}
            />
          </div>

          {/* Recurring Schedule */}
          <div className="space-y-4 border-t pt-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="recurrence_enabled">Recurring Schedule</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically create maintenance windows on a schedule
                </p>
              </div>
              <Switch
                id="recurrence_enabled"
                checked={formData.recurrence_enabled}
                onCheckedChange={(checked) => 
                  setFormData({ ...formData, recurrence_enabled: checked })
                }
              />
            </div>

            {formData.recurrence_enabled && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="recurrence_type">Recurrence Pattern</Label>
                  <Select
                    value={formData.recurrence_type}
                    onValueChange={(value: any) => {
                      let pattern = formData.recurrence_pattern;
                      if (value === 'monthly') pattern = '0 2 1 * *';
                      if (value === 'quarterly') pattern = '0 2 1 */3 *';
                      if (value === 'semi_annually') pattern = '0 2 1 1,7 *';
                      if (value === 'yearly') pattern = '0 2 1 1 *';
                      setFormData({ ...formData, recurrence_type: value, recurrence_pattern: pattern });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">
                        <div className="space-y-1">
                          <div className="font-medium">Monthly</div>
                          <div className="text-xs text-muted-foreground">1st of every month (common for patch cycles)</div>
                        </div>
                      </SelectItem>
                      <SelectItem value="quarterly">
                        <div className="space-y-1">
                          <div className="font-medium">Quarterly</div>
                          <div className="text-xs text-muted-foreground">Every 3 months (standard firmware update cycle)</div>
                        </div>
                      </SelectItem>
                      <SelectItem value="semi_annually">
                        <div className="space-y-1">
                          <div className="font-medium">Semi-Annually</div>
                          <div className="text-xs text-muted-foreground">Twice per year (Jan & July)</div>
                        </div>
                      </SelectItem>
                      <SelectItem value="yearly">
                        <div className="space-y-1">
                          <div className="font-medium">Yearly</div>
                          <div className="text-xs text-muted-foreground">Once per year (January 1st)</div>
                        </div>
                      </SelectItem>
                      <SelectItem value="custom">
                        <div className="space-y-1">
                          <div className="font-medium">Custom (Cron)</div>
                          <div className="text-xs text-muted-foreground">Advanced cron expression for custom schedules</div>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="recurrence_pattern">
                    Cron Pattern
                    {formData.recurrence_type !== 'custom' && (
                      <span className="text-xs text-muted-foreground ml-2">(auto-generated)</span>
                    )}
                  </Label>
                  <Input
                    id="recurrence_pattern"
                    value={formData.recurrence_pattern}
                    onChange={(e) => setFormData({ ...formData, recurrence_pattern: e.target.value })}
                    placeholder="0 2 * * 0"
                    disabled={formData.recurrence_type !== 'custom'}
                    className="font-mono"
                  />
                  {formData.recurrence_type === 'monthly' && (
                    <p className="text-xs text-muted-foreground">
                      <Info className="h-3 w-3 inline mr-1" />
                      Will run on the 1st of every month at 2:00 AM
                    </p>
                  )}
                  {formData.recurrence_type === 'quarterly' && (
                    <p className="text-xs text-muted-foreground">
                      <Info className="h-3 w-3 inline mr-1" />
                      Will run every 3 months (Jan, Apr, Jul, Oct) on the 1st at 2:00 AM
                    </p>
                  )}
                  {formData.recurrence_type === 'semi_annually' && (
                    <p className="text-xs text-muted-foreground">
                      <Info className="h-3 w-3 inline mr-1" />
                      Will run twice per year (January 1st and July 1st) at 2:00 AM
                    </p>
                  )}
                  {formData.recurrence_type === 'yearly' && (
                    <p className="text-xs text-muted-foreground">
                      <Info className="h-3 w-3 inline mr-1" />
                      Will run once per year on January 1st at 2:00 AM
                    </p>
                  )}
                  {formData.recurrence_type === 'custom' && (
                    <p className="text-xs text-muted-foreground">
                      Format: minute hour day month weekday (e.g., "0 2 1 * *" = 1st of month at 2:00 AM)
                    </p>
                  )}
                </div>

                <Alert>
                  <Calendar className="h-4 w-4" />
                  <AlertDescription>
                    <div className="space-y-1">
                      <div className="font-medium">Next 3 Scheduled Executions:</div>
                      <div className="text-xs space-y-0.5">
                        {getNextExecutions(formData.recurrence_pattern, 3).map((date, i) => (
                          <div key={i}>• {format(date, "PPpp")}</div>
                        ))}
                      </div>
                    </div>
                  </AlertDescription>
                </Alert>
              </>
            )}
          </div>

          {validation && (
            <Alert variant={validation.is_safe ? "default" : "destructive"}>
              {validation.is_safe ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <AlertTriangle className="h-4 w-4" />
              )}
              <AlertDescription>
                {validation.is_safe 
                  ? "All selected clusters are safe for maintenance"
                  : validation.warnings.join('. ')}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={validateWindow}
            disabled={validating || loading}
          >
            {validating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Validating...
              </>
            ) : (
              "Validate Safety"
            )}
          </Button>
          <Button onClick={handleSubmit} disabled={loading || validating}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              "Create Window"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
