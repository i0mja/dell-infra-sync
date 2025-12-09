import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ProtectionGroup, useReplicationTargets } from "@/hooks/useReplication";
import { useVCenters } from "@/hooks/useVCenters";
import { useAccessibleDatastores } from "@/hooks/useAccessibleDatastores";
import { supabase } from "@/integrations/supabase/client";
import { 
  ArrowRight, 
  Target, 
  Server, 
  HardDrive, 
  AlertTriangle, 
  Info,
  CheckCircle2,
  XCircle,
  RefreshCw
} from "lucide-react";

interface EditProtectionGroupDialogProps {
  group: ProtectionGroup | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, updates: Partial<ProtectionGroup>, originalGroup?: ProtectionGroup) => Promise<void>;
}

const SCHEDULE_PRESETS = [
  { label: "Every 15 minutes", value: "*/15 * * * *" },
  { label: "Every 30 minutes", value: "*/30 * * * *" },
  { label: "Hourly", value: "0 * * * *" },
  { label: "Every 4 hours", value: "0 */4 * * *" },
  { label: "Daily at midnight", value: "0 0 * * *" },
  { label: "Custom", value: "custom" },
];

const PRIORITY_OPTIONS = [
  { label: "Low", value: "low", color: "bg-slate-500" },
  { label: "Medium", value: "medium", color: "bg-blue-500" },
  { label: "High", value: "high", color: "bg-amber-500" },
  { label: "Critical", value: "critical", color: "bg-red-500" },
];

export function EditProtectionGroupDialog({
  group,
  open,
  onOpenChange,
  onSave,
}: EditProtectionGroupDialogProps) {
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("general");
  
  // Form state - General
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<string>("medium");
  
  // Form state - Sites
  const [sourceVCenterId, setSourceVCenterId] = useState("");
  const [sourceDatastore, setSourceDatastore] = useState("");
  const [drVCenterId, setDrVCenterId] = useState("");
  const [drDatastore, setDrDatastore] = useState("");
  
  // Form state - SLA
  const [rpoMinutes, setRpoMinutes] = useState(60);
  const [rpoUnit, setRpoUnit] = useState<"seconds" | "minutes" | "hours">("minutes");
  const [journalHistoryHours, setJournalHistoryHours] = useState(24);
  const [testReminderDays, setTestReminderDays] = useState(30);
  const [schedulePreset, setSchedulePreset] = useState("0 * * * *");
  const [customSchedule, setCustomSchedule] = useState("");
  
  // Form state - Retention
  const [retentionDaily, setRetentionDaily] = useState(7);
  const [retentionWeekly, setRetentionWeekly] = useState(4);
  const [retentionMonthly, setRetentionMonthly] = useState(12);

  // Fetch data for sites tab
  const { vcenters } = useVCenters();
  const { data: sourceDatastores = [] } = useAccessibleDatastores(sourceVCenterId || undefined);
  const { data: drDatastores = [] } = useAccessibleDatastores(drVCenterId || undefined);
  const { targets: replicationTargets } = useReplicationTargets();

  // Query for pending sync jobs for this protection group
  const { data: pendingSyncJobs = [] } = useQuery({
    queryKey: ['sync-jobs', group?.id],
    queryFn: async () => {
      if (!group?.id) return [];
      const { data } = await supabase
        .from('jobs')
        .select('id, status, created_at')
        .eq('job_type', 'sync_protection_config')
        .contains('target_scope', { protection_group_id: group.id })
        .in('status', ['pending', 'running'])
        .order('created_at', { ascending: false });
      return data || [];
    },
    enabled: !!group?.id && open,
    refetchInterval: 5000, // Poll every 5 seconds when open
  });

  // Group datastores by their linked ZFS target
  const sourceDatastoresByTarget = useMemo(() => {
    const grouped: Record<string, typeof sourceDatastores> = {};
    const unlinked: typeof sourceDatastores = [];
    
    sourceDatastores.forEach(ds => {
      if (ds.replication_target_id && ds.replication_target) {
        const targetName = ds.replication_target.name;
        if (!grouped[targetName]) grouped[targetName] = [];
        grouped[targetName].push(ds);
      } else {
        unlinked.push(ds);
      }
    });
    
    return { grouped, unlinked };
  }, [sourceDatastores]);

  const drDatastoresByTarget = useMemo(() => {
    const grouped: Record<string, typeof drDatastores> = {};
    const unlinked: typeof drDatastores = [];
    
    drDatastores.forEach(ds => {
      if (ds.replication_target_id && ds.replication_target) {
        const targetName = ds.replication_target.name;
        if (!grouped[targetName]) grouped[targetName] = [];
        grouped[targetName].push(ds);
      } else {
        unlinked.push(ds);
      }
    });
    
    return { grouped, unlinked };
  }, [drDatastores]);

  // Get linked ZFS target info for selected datastores
  const sourceDatastoreInfo = useMemo(() => {
    return sourceDatastores.find(ds => ds.name === sourceDatastore);
  }, [sourceDatastores, sourceDatastore]);

  const drDatastoreInfo = useMemo(() => {
    return drDatastores.find(ds => ds.name === drDatastore);
  }, [drDatastores, drDatastore]);

  const sourceTarget = sourceDatastoreInfo?.replication_target;
  const drTarget = drDatastoreInfo?.replication_target;

  // Initialize form from group
  useEffect(() => {
    if (group) {
      setName(group.name);
      setDescription(group.description || "");
      setPriority(group.priority || "medium");
      setJournalHistoryHours(group.journal_history_hours || 24);
      setTestReminderDays(group.test_reminder_days || 30);
      setRetentionDaily(group.retention_policy?.daily || 7);
      setRetentionWeekly(group.retention_policy?.weekly || 4);
      setRetentionMonthly(group.retention_policy?.monthly || 12);
      
      // Site configuration
      setSourceVCenterId(group.source_vcenter_id || "");
      setSourceDatastore(group.protection_datastore || "");
      setDrDatastore(group.dr_datastore || "");
      
      // Parse RPO
      const rpo = group.rpo_minutes || 60;
      if (rpo >= 60 && rpo % 60 === 0) {
        setRpoMinutes(rpo / 60);
        setRpoUnit("hours");
      } else if (rpo < 1) {
        setRpoMinutes(rpo * 60);
        setRpoUnit("seconds");
      } else {
        setRpoMinutes(rpo);
        setRpoUnit("minutes");
      }
      
      // Parse schedule
      const schedule = group.replication_schedule || "0 * * * *";
      const preset = SCHEDULE_PRESETS.find(p => p.value === schedule);
      if (preset) {
        setSchedulePreset(schedule);
        setCustomSchedule("");
      } else {
        setSchedulePreset("custom");
        setCustomSchedule(schedule);
      }
    }
  }, [group]);

  // Try to derive DR vCenter from the target
  useEffect(() => {
    if (group?.target_id && replicationTargets.length > 0) {
      const target = replicationTargets.find(t => t.id === group.target_id);
      if (target?.partner_target?.dr_vcenter_id) {
        setDrVCenterId(target.partner_target.dr_vcenter_id);
      }
    }
  }, [group, replicationTargets]);

  const handleSave = async () => {
    if (!group) return;
    
    setSaving(true);
    try {
      // Convert RPO to minutes
      let rpoInMinutes = rpoMinutes;
      if (rpoUnit === "seconds") {
        rpoInMinutes = rpoMinutes / 60;
      } else if (rpoUnit === "hours") {
        rpoInMinutes = rpoMinutes * 60;
      }
      
      await onSave(group.id, {
        name,
        description,
        priority: priority as ProtectionGroup['priority'],
        rpo_minutes: rpoInMinutes,
        journal_history_hours: journalHistoryHours,
        test_reminder_days: testReminderDays,
        replication_schedule: schedulePreset === "custom" ? customSchedule : schedulePreset,
        retention_policy: {
          daily: retentionDaily,
          weekly: retentionWeekly,
          monthly: retentionMonthly,
        },
        source_vcenter_id: sourceVCenterId || undefined,
        protection_datastore: sourceDatastore || undefined,
        dr_datastore: drDatastore || undefined,
        target_id: sourceTarget?.id || undefined,
      }, group);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const selectedPriority = PRIORITY_OPTIONS.find(p => p.value === priority);
  const sourceVCenter = vcenters.find(v => v.id === sourceVCenterId);
  const drVCenter = vcenters.find(v => v.id === drVCenterId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Protection Group</DialogTitle>
          <DialogDescription>
            Modify settings for {group?.name}
          </DialogDescription>
        </DialogHeader>

        {/* Pending Sync Jobs Indicator */}
        {pendingSyncJobs.length > 0 && (
          <Alert className="border-primary/50 bg-primary/10">
            <RefreshCw className="h-4 w-4 animate-spin text-primary" />
            <AlertDescription className="text-sm">
              Syncing configuration to ZFS appliances...
              {pendingSyncJobs[0]?.status === 'running' && ' (in progress)'}
            </AlertDescription>
          </Alert>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="sites">Sites</TabsTrigger>
            <TabsTrigger value="sla">SLA Settings</TabsTrigger>
            <TabsTrigger value="retention">Retention</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Group Name</Label>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <div className="flex gap-2">
                {PRIORITY_OPTIONS.map((opt) => (
                  <Button
                    key={opt.value}
                    type="button"
                    variant={priority === opt.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPriority(opt.value)}
                    className="flex-1"
                  >
                    <span className={`w-2 h-2 rounded-full mr-2 ${opt.color}`} />
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="sites" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-6">
              {/* Source Site (Point A) */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-primary" />
                  <h4 className="font-medium">Source Site (Point A)</h4>
                </div>
                
                <div className="space-y-2">
                  <Label>Source vCenter</Label>
                  <Select value={sourceVCenterId} onValueChange={setSourceVCenterId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select vCenter" />
                    </SelectTrigger>
                    <SelectContent>
                      {vcenters.map(vc => (
                        <SelectItem key={vc.id} value={vc.id}>
                          {vc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Protection Datastore</Label>
                  <Select 
                    value={sourceDatastore} 
                    onValueChange={setSourceDatastore}
                    disabled={!sourceVCenterId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select datastore" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(sourceDatastoresByTarget.grouped).map(([targetName, datastores]) => (
                        <SelectGroup key={targetName}>
                          <SelectLabel className="flex items-center gap-2">
                            <Target className="h-3 w-3" />
                            {targetName}
                          </SelectLabel>
                          {datastores.map(ds => (
                            <SelectItem key={ds.id} value={ds.name}>
                              <div className="flex items-center gap-2">
                                <HardDrive className="h-3 w-3" />
                                {ds.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                      {sourceDatastoresByTarget.unlinked.length > 0 && (
                        <SelectGroup>
                          <SelectLabel className="flex items-center gap-2 text-muted-foreground">
                            <AlertTriangle className="h-3 w-3" />
                            Unlinked Datastores
                          </SelectLabel>
                          {sourceDatastoresByTarget.unlinked.map(ds => (
                            <SelectItem key={ds.id} value={ds.name}>
                              <div className="flex items-center gap-2">
                                <HardDrive className="h-3 w-3" />
                                {ds.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                {/* Source ZFS Target Info */}
                {sourceDatastore && (
                  <div className="p-3 rounded-lg bg-muted/50 space-y-2">
                    {sourceTarget ? (
                      <>
                        <div className="flex items-center gap-2 text-sm">
                          <Target className="h-4 w-4 text-primary" />
                          <span className="font-medium">{sourceTarget.name}</span>
                          <Badge variant={sourceTarget.health_status === 'healthy' ? 'default' : 'destructive'} className="text-xs">
                            {sourceTarget.health_status || 'unknown'}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <p>{sourceTarget.hostname} • Pool: {sourceTarget.zfs_pool}</p>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-amber-600">
                        <AlertTriangle className="h-4 w-4" />
                        <span>No ZFS target linked to this datastore</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* DR Site (Point B) */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-destructive" />
                  <h4 className="font-medium">DR Site (Point B)</h4>
                </div>
                
                <div className="space-y-2">
                  <Label>DR vCenter</Label>
                  <Select value={drVCenterId} onValueChange={setDrVCenterId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select vCenter" />
                    </SelectTrigger>
                    <SelectContent>
                      {vcenters
                        .filter(vc => vc.id !== sourceVCenterId)
                        .map(vc => (
                          <SelectItem key={vc.id} value={vc.id}>
                            {vc.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>DR Datastore</Label>
                  <Select 
                    value={drDatastore} 
                    onValueChange={setDrDatastore}
                    disabled={!drVCenterId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select datastore" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(drDatastoresByTarget.grouped).map(([targetName, datastores]) => (
                        <SelectGroup key={targetName}>
                          <SelectLabel className="flex items-center gap-2">
                            <Target className="h-3 w-3" />
                            {targetName}
                          </SelectLabel>
                          {datastores.map(ds => (
                            <SelectItem key={ds.id} value={ds.name}>
                              <div className="flex items-center gap-2">
                                <HardDrive className="h-3 w-3" />
                                {ds.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                      {drDatastoresByTarget.unlinked.length > 0 && (
                        <SelectGroup>
                          <SelectLabel className="flex items-center gap-2 text-muted-foreground">
                            <AlertTriangle className="h-3 w-3" />
                            Unlinked Datastores
                          </SelectLabel>
                          {drDatastoresByTarget.unlinked.map(ds => (
                            <SelectItem key={ds.id} value={ds.name}>
                              <div className="flex items-center gap-2">
                                <HardDrive className="h-3 w-3" />
                                {ds.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                {/* DR ZFS Target Info */}
                {drDatastore && (
                  <div className="p-3 rounded-lg bg-muted/50 space-y-2">
                    {drTarget ? (
                      <>
                        <div className="flex items-center gap-2 text-sm">
                          <Target className="h-4 w-4 text-destructive" />
                          <span className="font-medium">{drTarget.name}</span>
                          <Badge variant={drTarget.health_status === 'healthy' ? 'default' : 'destructive'} className="text-xs">
                            {drTarget.health_status || 'unknown'}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <p>{drTarget.hostname} • Pool: {drTarget.zfs_pool}</p>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-amber-600">
                        <AlertTriangle className="h-4 w-4" />
                        <span>No ZFS target linked to this datastore</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Replication Flow Visualization */}
            {(sourceDatastore || drDatastore) && (
              <div className="mt-6 p-4 rounded-lg border bg-card">
                <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Info className="h-4 w-4" />
                  Replication Flow
                </h4>
                <div className="flex items-center justify-center gap-4">
                  {/* Source */}
                  <div className="text-center p-3 rounded-lg bg-primary/10 min-w-[140px]">
                    <p className="text-xs text-muted-foreground mb-1">Source</p>
                    <p className="font-medium text-sm">{sourceDatastore || "Not selected"}</p>
                    {sourceVCenter && (
                      <p className="text-xs text-muted-foreground mt-1">{sourceVCenter.name}</p>
                    )}
                    {sourceTarget && (
                      <div className="flex items-center justify-center gap-1 mt-2">
                        <Target className="h-3 w-3 text-primary" />
                        <span className="text-xs">{sourceTarget.name}</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Arrow */}
                  <div className="flex flex-col items-center">
                    <ArrowRight className="h-6 w-6 text-muted-foreground" />
                    {sourceTarget?.partner_target_id && drTarget?.id === sourceTarget.partner_target_id ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500 mt-1" />
                    ) : sourceTarget && drTarget ? (
                      <XCircle className="h-4 w-4 text-amber-500 mt-1" />
                    ) : null}
                  </div>
                  
                  {/* DR */}
                  <div className="text-center p-3 rounded-lg bg-destructive/10 min-w-[140px]">
                    <p className="text-xs text-muted-foreground mb-1">DR</p>
                    <p className="font-medium text-sm">{drDatastore || "Not selected"}</p>
                    {drVCenter && (
                      <p className="text-xs text-muted-foreground mt-1">{drVCenter.name}</p>
                    )}
                    {drTarget && (
                      <div className="flex items-center justify-center gap-1 mt-2">
                        <Target className="h-3 w-3 text-destructive" />
                        <span className="text-xs">{drTarget.name}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Pairing Status */}
                {sourceTarget && drTarget && sourceTarget.partner_target_id !== drTarget.id && (
                  <Alert className="mt-3" variant="default">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      The source and DR ZFS targets are not paired. Configure pairing in the ZFS Targets section for automated replication.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="sla" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>RPO Target</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={1}
                  value={rpoMinutes}
                  onChange={(e) => setRpoMinutes(parseInt(e.target.value) || 1)}
                  className="flex-1"
                />
                <Select value={rpoUnit} onValueChange={(v) => setRpoUnit(v as typeof rpoUnit)}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="seconds">Seconds</SelectItem>
                    <SelectItem value="minutes">Minutes</SelectItem>
                    <SelectItem value="hours">Hours</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {group?.current_rpo_seconds && (
                <p className="text-xs text-muted-foreground">
                  Current RPO: {Math.round(group.current_rpo_seconds / 60)} minutes
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="journal-hours">Journal History (hours)</Label>
              <Input
                id="journal-hours"
                type="number"
                min={1}
                max={720}
                value={journalHistoryHours}
                onChange={(e) => setJournalHistoryHours(parseInt(e.target.value) || 24)}
              />
              <p className="text-xs text-muted-foreground">
                How long to keep point-in-time recovery data
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="test-reminder">Test Reminder (days)</Label>
              <Input
                id="test-reminder"
                type="number"
                min={1}
                max={365}
                value={testReminderDays}
                onChange={(e) => setTestReminderDays(parseInt(e.target.value) || 30)}
              />
              <p className="text-xs text-muted-foreground">
                Remind to test failover after this many days
              </p>
            </div>
            <div className="space-y-2">
              <Label>Replication Schedule</Label>
              <Select value={schedulePreset} onValueChange={setSchedulePreset}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCHEDULE_PRESETS.map((preset) => (
                    <SelectItem key={preset.value} value={preset.value}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {schedulePreset === "custom" && (
                <Input
                  placeholder="Cron expression (e.g., */5 * * * *)"
                  value={customSchedule}
                  onChange={(e) => setCustomSchedule(e.target.value)}
                  className="mt-2"
                />
              )}
            </div>
          </TabsContent>

          <TabsContent value="retention" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">
              Configure how many recovery points to keep
            </p>
            <div className="space-y-2">
              <Label htmlFor="retention-daily">Daily Snapshots</Label>
              <Input
                id="retention-daily"
                type="number"
                min={0}
                max={365}
                value={retentionDaily}
                onChange={(e) => setRetentionDaily(parseInt(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="retention-weekly">Weekly Snapshots</Label>
              <Input
                id="retention-weekly"
                type="number"
                min={0}
                max={52}
                value={retentionWeekly}
                onChange={(e) => setRetentionWeekly(parseInt(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="retention-monthly">Monthly Snapshots</Label>
              <Input
                id="retention-monthly"
                type="number"
                min={0}
                max={120}
                value={retentionMonthly}
                onChange={(e) => setRetentionMonthly(parseInt(e.target.value) || 0)}
              />
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
