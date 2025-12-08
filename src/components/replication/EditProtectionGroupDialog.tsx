import { useState, useEffect } from "react";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ProtectionGroup } from "@/hooks/useReplication";

interface EditProtectionGroupDialogProps {
  group: ProtectionGroup | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, updates: Partial<ProtectionGroup>) => Promise<void>;
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
  
  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<string>("medium");
  const [rpoMinutes, setRpoMinutes] = useState(60);
  const [rpoUnit, setRpoUnit] = useState<"seconds" | "minutes" | "hours">("minutes");
  const [journalHistoryHours, setJournalHistoryHours] = useState(24);
  const [testReminderDays, setTestReminderDays] = useState(30);
  const [schedulePreset, setSchedulePreset] = useState("0 * * * *");
  const [customSchedule, setCustomSchedule] = useState("");
  const [retentionDaily, setRetentionDaily] = useState(7);
  const [retentionWeekly, setRetentionWeekly] = useState(4);
  const [retentionMonthly, setRetentionMonthly] = useState(12);

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
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const selectedPriority = PRIORITY_OPTIONS.find(p => p.value === priority);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Protection Group</DialogTitle>
          <DialogDescription>
            Modify settings for {group?.name}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="general">General</TabsTrigger>
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
