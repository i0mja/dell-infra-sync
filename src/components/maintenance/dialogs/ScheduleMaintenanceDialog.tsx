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
import { FirmwareSourceSelector } from "@/components/common/FirmwareSourceSelector";
import { Switch } from "@/components/ui/switch";
import { getNextExecutionsFromConfig, getHumanReadableSchedule, type RecurrenceConfig } from "@/lib/cron-utils";
import { Calendar, Clock } from "lucide-react";

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
    firmware_source: "local_repository" as "local_repository" | "dell_online_catalog" | "skip" | "manual",
    component_filter: ["all"] as string[],
    auto_select_latest: true,
    recurrence_enabled: false,
    recurrence_interval: 1,
    recurrence_unit: 'weeks' as 'hours' | 'days' | 'weeks' | 'months' | 'years',
    recurrence_hour: 2,
    recurrence_minute: 0,
    recurrence_day_of_week: 0,
    recurrence_day_of_month: 1,
    recurrence_advanced: false,
    recurrence_custom_cron: '',
  });

  const recurrenceConfig: RecurrenceConfig = {
    enabled: formData.recurrence_enabled,
    interval: formData.recurrence_interval,
    unit: formData.recurrence_unit,
    hour: formData.recurrence_hour,
    minute: formData.recurrence_minute,
    dayOfWeek: formData.recurrence_day_of_week,
    dayOfMonth: formData.recurrence_day_of_month,
    customCron: formData.recurrence_advanced ? formData.recurrence_custom_cron : undefined,
  };

  const nextExecutions = formData.recurrence_enabled 
    ? getNextExecutionsFromConfig(recurrenceConfig, new Date(), 5)
    : [];

  const scheduleDescription = formData.recurrence_enabled 
    ? getHumanReadableSchedule(recurrenceConfig)
    : null;

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

      const insertData = {
        title: formData.title,
        description: formData.description || null,
        cluster_ids: formData.cluster_ids.length > 0 ? formData.cluster_ids : null,
        server_group_ids: formData.server_group_ids.length > 0 ? formData.server_group_ids : null,
        planned_start: new Date(formData.planned_start).toISOString(),
        planned_end: new Date(formData.planned_end).toISOString(),
        maintenance_type: formData.maintenance_type,
        created_by: user.id,
        safety_check_snapshot: validation || null,
        status: 'planned' as const,
        auto_execute: formData.auto_execute,
        recurrence_enabled: formData.recurrence_enabled || null,
        recurrence_type: formData.recurrence_enabled ? formData.recurrence_unit : null,
        recurrence_pattern: (formData.recurrence_enabled && formData.recurrence_custom_cron) 
          ? formData.recurrence_custom_cron 
          : null,
        details: {
          firmware_source: formData.firmware_source,
          component_filter: formData.component_filter,
          auto_select_latest: formData.auto_select_latest,
          recurrence_config: formData.recurrence_enabled ? recurrenceConfig : null,
        } as any,
      };

      const { error } = await supabase
        .from('maintenance_windows')
        .insert(insertData);

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
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="basic">Basic</TabsTrigger>
            <TabsTrigger value="targets">Targets</TabsTrigger>
            <TabsTrigger value="firmware">Firmware</TabsTrigger>
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

          <TabsContent value="firmware" className="space-y-4 mt-4">
            <FirmwareSourceSelector
              value={formData.firmware_source}
              onChange={(value) => setFormData({ ...formData, firmware_source: value })}
              componentFilter={formData.component_filter}
              onComponentFilterChange={(components) => setFormData({ ...formData, component_filter: components })}
              autoSelectLatest={formData.auto_select_latest}
              onAutoSelectLatestChange={(value) => setFormData({ ...formData, auto_select_latest: value })}
              showSkipOption={true}
              showManualOption={false}
            />
          </TabsContent>

          <TabsContent value="schedule" className="space-y-6 mt-4">
            {/* One-time Schedule */}
            <div className="space-y-4">
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
            </div>

            {/* Recurring Schedule */}
            <div className="border-t pt-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label htmlFor="recurrence_enabled" className="text-base font-semibold flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Recurring Schedule
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Schedule this maintenance to repeat automatically
                  </p>
                </div>
                <Switch
                  id="recurrence_enabled"
                  checked={formData.recurrence_enabled}
                  onCheckedChange={(checked) => setFormData({ ...formData, recurrence_enabled: checked })}
                />
              </div>

              {formData.recurrence_enabled && (
                <div className="space-y-4 pl-6 border-l-2 border-primary/20">
                  {/* Quick Presets */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Quick Presets</Label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: 'Daily', interval: 1, unit: 'days', hour: 2 },
                        { label: 'Weekly', interval: 1, unit: 'weeks', hour: 2, dayOfWeek: 0 },
                        { label: 'Bi-weekly', interval: 2, unit: 'weeks', hour: 2, dayOfWeek: 0 },
                        { label: 'Monthly', interval: 1, unit: 'months', hour: 2, dayOfMonth: 1 },
                        { label: 'Quarterly', interval: 3, unit: 'months', hour: 2, dayOfMonth: 1 },
                        { label: 'Yearly', interval: 1, unit: 'years', hour: 2, dayOfMonth: 1 },
                        { label: 'Every 2 Years', interval: 2, unit: 'years', hour: 2, dayOfMonth: 1 },
                        { label: 'Every 5 Years', interval: 5, unit: 'years', hour: 2, dayOfMonth: 1 },
                      ].map((preset) => (
                        <Button
                          key={preset.label}
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setFormData({
                            ...formData,
                            recurrence_interval: preset.interval,
                            recurrence_unit: preset.unit as any,
                            recurrence_hour: preset.hour,
                            recurrence_minute: 0,
                            recurrence_day_of_week: preset.dayOfWeek || 0,
                            recurrence_day_of_month: preset.dayOfMonth || 1,
                            recurrence_advanced: false,
                          })}
                        >
                          {preset.label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {/* Interval Configuration */}
                  {!formData.recurrence_advanced && (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="interval">Run Every</Label>
                          <Input
                            id="interval"
                            type="number"
                            min="1"
                            max={formData.recurrence_unit === 'years' ? 10 : formData.recurrence_unit === 'months' ? 60 : 365}
                            value={formData.recurrence_interval}
                            onChange={(e) => setFormData({ ...formData, recurrence_interval: parseInt(e.target.value) || 1 })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="unit">Unit</Label>
                          <Select
                            value={formData.recurrence_unit}
                            onValueChange={(value: any) => setFormData({ ...formData, recurrence_unit: value })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="hours">Hours</SelectItem>
                              <SelectItem value="days">Days</SelectItem>
                              <SelectItem value="weeks">Weeks</SelectItem>
                              <SelectItem value="months">Months</SelectItem>
                              <SelectItem value="years">Years</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Day/Time Configuration */}
                      <div className="grid grid-cols-2 gap-4">
                        {formData.recurrence_unit === 'weeks' && (
                          <div className="space-y-2">
                            <Label htmlFor="day_of_week">Day of Week</Label>
                            <Select
                              value={String(formData.recurrence_day_of_week)}
                              onValueChange={(value) => setFormData({ ...formData, recurrence_day_of_week: parseInt(value) })}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="0">Sunday</SelectItem>
                                <SelectItem value="1">Monday</SelectItem>
                                <SelectItem value="2">Tuesday</SelectItem>
                                <SelectItem value="3">Wednesday</SelectItem>
                                <SelectItem value="4">Thursday</SelectItem>
                                <SelectItem value="5">Friday</SelectItem>
                                <SelectItem value="6">Saturday</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {(formData.recurrence_unit === 'months' || formData.recurrence_unit === 'years') && (
                          <div className="space-y-2">
                            <Label htmlFor="day_of_month">Day of Month</Label>
                            <Input
                              id="day_of_month"
                              type="number"
                              min="1"
                              max="31"
                              value={formData.recurrence_day_of_month}
                              onChange={(e) => setFormData({ ...formData, recurrence_day_of_month: parseInt(e.target.value) || 1 })}
                            />
                          </div>
                        )}

                        {formData.recurrence_unit !== 'hours' && (
                          <>
                            <div className="space-y-2">
                              <Label htmlFor="hour" className="flex items-center gap-2">
                                <Clock className="h-4 w-4" />
                                Hour (24h)
                              </Label>
                              <Input
                                id="hour"
                                type="number"
                                min="0"
                                max="23"
                                value={formData.recurrence_hour}
                                onChange={(e) => setFormData({ ...formData, recurrence_hour: parseInt(e.target.value) || 0 })}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="minute">Minute</Label>
                              <Input
                                id="minute"
                                type="number"
                                min="0"
                                max="59"
                                value={formData.recurrence_minute}
                                onChange={(e) => setFormData({ ...formData, recurrence_minute: parseInt(e.target.value) || 0 })}
                              />
                            </div>
                          </>
                        )}

                        {formData.recurrence_unit === 'hours' && (
                          <div className="space-y-2">
                            <Label htmlFor="minute">At Minute</Label>
                            <Input
                              id="minute"
                              type="number"
                              min="0"
                              max="59"
                              value={formData.recurrence_minute}
                              onChange={(e) => setFormData({ ...formData, recurrence_minute: parseInt(e.target.value) || 0 })}
                            />
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {/* Advanced Mode */}
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="advanced"
                      checked={formData.recurrence_advanced}
                      onCheckedChange={(checked) => setFormData({ ...formData, recurrence_advanced: checked as boolean })}
                    />
                    <label htmlFor="advanced" className="text-sm cursor-pointer">
                      Advanced mode (custom cron pattern)
                    </label>
                  </div>

                  {formData.recurrence_advanced && (
                    <div className="space-y-2">
                      <Label htmlFor="cron">Cron Pattern</Label>
                      <Input
                        id="cron"
                        value={formData.recurrence_custom_cron}
                        onChange={(e) => setFormData({ ...formData, recurrence_custom_cron: e.target.value })}
                        placeholder="0 2 * * 0 (minute hour day month weekday)"
                      />
                      <p className="text-xs text-muted-foreground">
                        Format: minute hour day month weekday (e.g., "0 2 * * 0" = Every Sunday at 2:00 AM)
                      </p>
                    </div>
                  )}

                  {/* Schedule Preview */}
                  {scheduleDescription && (
                    <Alert>
                      <Calendar className="h-4 w-4" />
                      <AlertDescription>
                        <div className="space-y-2">
                          <p className="font-medium">{scheduleDescription}</p>
                          {nextExecutions.length > 0 && (
                            <div className="space-y-1">
                              <p className="text-sm font-medium">Next Scheduled Runs:</p>
                              {nextExecutions.map((date, i) => (
                                <div key={i} className="text-sm text-muted-foreground">
                                  • {format(date, 'PPpp')}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
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
