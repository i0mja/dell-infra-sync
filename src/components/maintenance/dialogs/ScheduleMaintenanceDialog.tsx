import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle, AlertTriangle } from "lucide-react";
import { format, addHours } from "date-fns";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface ScheduleMaintenanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clusters: string[];
  serverGroups: Array<{ id: string; name: string }>;
  prefilledData?: {
    start?: Date;
    end?: Date;
    clusters?: string[];
    serverGroupIds?: string[];
  };
  onSuccess: () => void;
}

export function ScheduleMaintenanceDialog({
  open,
  onOpenChange,
  clusters,
  serverGroups,
  prefilledData,
  onSuccess
}: ScheduleMaintenanceDialogProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<{ is_safe: boolean; warnings: string[] } | null>(null);

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    cluster_ids: prefilledData?.clusters || [],
    server_group_ids: prefilledData?.serverGroupIds || [],
    planned_start: prefilledData?.start 
      ? format(prefilledData.start, "yyyy-MM-dd'T'HH:mm") 
      : format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    planned_end: prefilledData?.end 
      ? format(prefilledData.end, "yyyy-MM-dd'T'HH:mm") 
      : format(addHours(new Date(), 4), "yyyy-MM-dd'T'HH:mm"),
    maintenance_type: "firmware_update" as "firmware_update" | "host_maintenance" | "cluster_update" | "full_update",
    auto_execute: true,
  });

  useEffect(() => {
    if (!open) return;

    setFormData((current) => ({
      ...current,
      cluster_ids: prefilledData?.clusters || [],
      server_group_ids: prefilledData?.serverGroupIds || [],
      planned_start: prefilledData?.start
        ? format(prefilledData.start, "yyyy-MM-dd'T'HH:mm")
        : format(new Date(), "yyyy-MM-dd'T'HH:mm"),
      planned_end: prefilledData?.end
        ? format(prefilledData.end, "yyyy-MM-dd'T'HH:mm")
        : format(addHours(prefilledData?.start || new Date(), 4), "yyyy-MM-dd'T'HH:mm"),
    }));
  }, [prefilledData, open]);

  const validateWindow = async () => {
    if (formData.cluster_ids.length === 0 && formData.server_group_ids.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please select at least one cluster or server group",
        variant: "destructive"
      });
      return;
    }

    setValidating(true);
    try {
      const warnings: string[] = [];
      let allSafe = true;

      // Validate clusters
      if (formData.cluster_ids.length > 0) {
        const { data: clusterChecks } = await supabase
          .from('cluster_safety_checks')
          .select('*')
          .in('cluster_id', formData.cluster_ids)
          .gte('check_timestamp', new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
          .order('check_timestamp', { ascending: false });

        const latestByCluster = new Map();
        for (const check of clusterChecks || []) {
          if (!latestByCluster.has(check.cluster_id)) {
            latestByCluster.set(check.cluster_id, check);
          }
        }

        if (!formData.cluster_ids.every(id => latestByCluster.get(id)?.safe_to_proceed)) {
          warnings.push('Some clusters may not be safe for maintenance');
          allSafe = false;
        }
      }

      // Validate server groups
      if (formData.server_group_ids.length > 0) {
        const { data: groupChecks } = await supabase
          .from('server_group_safety_checks')
          .select('*')
          .in('server_group_id', formData.server_group_ids)
          .gte('check_timestamp', new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
          .order('check_timestamp', { ascending: false });

        const latestByGroup = new Map();
        for (const check of groupChecks || []) {
          if (!latestByGroup.has(check.server_group_id)) {
            latestByGroup.set(check.server_group_id, check);
          }
        }

        if (!formData.server_group_ids.every(id => latestByGroup.get(id)?.safe_to_proceed)) {
          warnings.push('Some server groups may not be safe for maintenance');
          allSafe = false;
        }
      }

      setValidation({ is_safe: allSafe, warnings });
      toast({
        title: allSafe ? "Validation Successful" : "Validation Warnings",
        description: allSafe ? "All targets are safe for maintenance" : warnings[0],
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

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from('maintenance_windows')
        .insert({
          title: formData.title,
          description: formData.description || null,
          cluster_ids: formData.cluster_ids.length > 0 ? formData.cluster_ids : null,
          server_group_ids: formData.server_group_ids.length > 0 ? formData.server_group_ids : null,
          planned_start: new Date(formData.planned_start).toISOString(),
          planned_end: new Date(formData.planned_end).toISOString(),
          maintenance_type: formData.maintenance_type,
          created_by: user.id,
          safety_check_snapshot: validation || null,
          status: 'planned',
          auto_execute: formData.auto_execute,
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Maintenance window created successfully",
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
            Configure and schedule a maintenance window with safety validation
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="basic">Basic</TabsTrigger>
            <TabsTrigger value="targets">Targets</TabsTrigger>
            <TabsTrigger value="schedule">Schedule</TabsTrigger>
            <TabsTrigger value="validation">Validation</TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="space-y-4 mt-4">
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

            <div className="space-y-2">
              <Label htmlFor="maintenance_type">Maintenance Type</Label>
              <Select
                value={formData.maintenance_type}
                onValueChange={(value: any) => setFormData({ ...formData, maintenance_type: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="firmware_update">Firmware Update</SelectItem>
                  <SelectItem value="host_maintenance">Host Maintenance</SelectItem>
                  <SelectItem value="cluster_update">Cluster Update</SelectItem>
                  <SelectItem value="full_update">Full Update</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </TabsContent>

          <TabsContent value="targets" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Clusters</Label>
              <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-3">
                {clusters.map((cluster) => (
                  <div key={cluster} className="flex items-center space-x-2">
                    <Checkbox
                      id={`cluster-${cluster}`}
                      checked={formData.cluster_ids.includes(cluster)}
                      onCheckedChange={(checked) => {
                        setFormData({
                          ...formData,
                          cluster_ids: checked
                            ? [...formData.cluster_ids, cluster]
                            : formData.cluster_ids.filter(c => c !== cluster)
                        });
                      }}
                    />
                    <label htmlFor={`cluster-${cluster}`} className="text-sm cursor-pointer">
                      {cluster}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Server Groups</Label>
              <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-3">
                {serverGroups.map((group) => (
                  <div key={group.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`group-${group.id}`}
                      checked={formData.server_group_ids.includes(group.id)}
                      onCheckedChange={(checked) => {
                        setFormData({
                          ...formData,
                          server_group_ids: checked
                            ? [...formData.server_group_ids, group.id]
                            : formData.server_group_ids.filter(g => g !== group.id)
                        });
                      }}
                    />
                    <label htmlFor={`group-${group.id}`} className="text-sm cursor-pointer">
                      {group.name}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="schedule" className="space-y-4 mt-4">
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

            <div className="flex items-center space-x-2">
              <Checkbox
                id="auto_execute"
                checked={formData.auto_execute}
                onCheckedChange={(checked) => setFormData({ ...formData, auto_execute: checked as boolean })}
              />
              <label htmlFor="auto_execute" className="text-sm cursor-pointer">
                Automatically execute jobs at start time
              </label>
            </div>
          </TabsContent>

          <TabsContent value="validation" className="space-y-4 mt-4">
            <Button onClick={validateWindow} disabled={validating} className="w-full">
              {validating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Validating...
                </>
              ) : (
                'Run Safety Validation'
              )}
            </Button>

            {validation && (
              <Alert variant={validation.is_safe ? "default" : "destructive"}>
                {validation.is_safe ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <AlertTriangle className="h-4 w-4" />
                )}
                <AlertDescription>
                  {validation.is_safe 
                    ? "All selected targets are safe for maintenance" 
                    : validation.warnings.join(', ')}
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              'Schedule Maintenance'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
