import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, AlertTriangle, CheckCircle } from "lucide-react";
import { format, addHours } from "date-fns";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface CreateMaintenanceWindowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clusters: string[];
  serverGroups?: Array<{ id: string; name: string; }>;
  prefilledData?: {
    start: Date;
    end: Date;
    clusters?: string[];
    serverGroupIds?: string[];
  };
  onSuccess: () => void;
}

export function CreateMaintenanceWindowDialog({
  open,
  onOpenChange,
  clusters,
  serverGroups = [],
  prefilledData,
  onSuccess
}: CreateMaintenanceWindowDialogProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<{ is_safe: boolean; warnings: string[]; clusters_status?: any[] } | null>(null);

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    cluster_ids: prefilledData?.clusters || [],
    server_group_ids: prefilledData?.serverGroupIds || [],
    planned_start: prefilledData?.start ? format(prefilledData.start, "yyyy-MM-dd'T'HH:mm") : format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    planned_end: prefilledData?.end ? format(prefilledData.end, "yyyy-MM-dd'T'HH:mm") : format(addHours(new Date(), 4), "yyyy-MM-dd'T'HH:mm"),
    maintenance_type: "firmware_update" as const,
    notify_before_hours: 24
  });

  const validateWindow = async () => {
    if (formData.cluster_ids.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please select at least one cluster",
        variant: "destructive"
      });
      return;
    }

    setValidating(true);
    try {
      // Fetch recent safety checks for selected clusters
      const { data: recentChecks, error } = await supabase
        .from('cluster_safety_checks')
        .select('*')
        .in('cluster_id', formData.cluster_ids)
        .gte('check_timestamp', new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
        .order('check_timestamp', { ascending: false });

      if (error) throw error;

      // Group by cluster and get latest check
      const latestByCluster = new Map();
      for (const check of recentChecks || []) {
        if (!latestByCluster.has(check.cluster_id)) {
          latestByCluster.set(check.cluster_id, check);
        }
      }

      // Check if all clusters are safe
      const allSafe = formData.cluster_ids.every(clusterId => {
        const check = latestByCluster.get(clusterId);
        return check && check.safe_to_proceed;
      });

      const warnings: string[] = [];
      if (!allSafe) {
        warnings.push('Some clusters may not be safe for maintenance');
      }

      const missingChecks = formData.cluster_ids.filter(c => !latestByCluster.has(c));
      if (missingChecks.length > 0) {
        warnings.push(`No recent safety checks for: ${missingChecks.join(', ')}`);
      }

      setValidation({
        is_safe: allSafe && missingChecks.length === 0,
        warnings,
        clusters_status: Array.from(latestByCluster.values())
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

    if (formData.cluster_ids.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please select at least one cluster",
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
          cluster_ids: formData.cluster_ids,
          planned_start: new Date(formData.planned_start).toISOString(),
          planned_end: new Date(formData.planned_end).toISOString(),
          maintenance_type: formData.maintenance_type,
          notify_before_hours: formData.notify_before_hours,
          created_by: user.id,
          safety_check_snapshot: validation?.clusters_status || null
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
                <SelectItem value="firmware_update">Firmware Update</SelectItem>
                <SelectItem value="host_maintenance">Host Maintenance</SelectItem>
                <SelectItem value="cluster_upgrade">Cluster Upgrade</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>

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
