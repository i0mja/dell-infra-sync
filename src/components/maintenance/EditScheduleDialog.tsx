import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";
import { RecurrenceConfig } from "@/lib/cron-utils";

interface EditScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  window: any;
}

export function EditScheduleDialog({ open, onOpenChange, window }: EditScheduleDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);

  const [plannedStart, setPlannedStart] = useState(
    format(new Date(window.planned_start), "yyyy-MM-dd'T'HH:mm")
  );
  const [plannedEnd, setPlannedEnd] = useState(
    format(new Date(window.planned_end), "yyyy-MM-dd'T'HH:mm")
  );
  const [recurrenceEnabled, setRecurrenceEnabled] = useState(window.recurrence_enabled || false);
  const [recurrenceType, setRecurrenceType] = useState(
    window.recurrence_type || 'monthly'
  );
  const [customCron, setCustomCron] = useState('');

  const handleSave = async () => {
    setLoading(true);
    try {
      const startDate = new Date(plannedStart);
      const endDate = new Date(plannedEnd);

      if (endDate <= startDate) {
        toast({
          title: "Invalid schedule",
          description: "End time must be after start time.",
          variant: "destructive"
        });
        setLoading(false);
        return;
      }

      const updates: any = {
        planned_start: startDate.toISOString(),
        planned_end: endDate.toISOString(),
        recurrence_enabled: recurrenceEnabled,
        recurrence_type: recurrenceEnabled ? recurrenceType : null,
      };

      // Build recurrence config if enabled
      if (recurrenceEnabled) {
        const recurrenceConfig: RecurrenceConfig = {
          enabled: true,
          interval: 1,
          unit: recurrenceType as 'hours' | 'days' | 'weeks' | 'months' | 'years',
          hour: startDate.getHours(),
          minute: startDate.getMinutes(),
        };

        if (recurrenceType === 'monthly' || recurrenceType === 'years') {
          recurrenceConfig.dayOfMonth = startDate.getDate();
        }

        if (recurrenceType === 'weeks') {
          recurrenceConfig.dayOfWeek = startDate.getDay();
        }

        if (customCron) {
          recurrenceConfig.customCron = customCron;
        }

        updates.recurrence_pattern = JSON.stringify(recurrenceConfig);
      } else {
        updates.recurrence_pattern = null;
      }

      const { error } = await supabase
        .from('maintenance_windows')
        .update(updates)
        .eq('id', window.id);

      if (error) throw error;

      toast({
        title: "Schedule updated",
        description: "Maintenance window schedule has been updated successfully."
      });

      queryClient.invalidateQueries({ queryKey: ['maintenance-windows'] });
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: "Error updating schedule",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Schedule</DialogTitle>
          <DialogDescription>
            Update the timing and recurrence settings for this maintenance window.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="start">Start Date & Time</Label>
            <Input
              id="start"
              type="datetime-local"
              value={plannedStart}
              onChange={(e) => setPlannedStart(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="end">End Date & Time</Label>
            <Input
              id="end"
              type="datetime-local"
              value={plannedEnd}
              onChange={(e) => setPlannedEnd(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="recurring">Recurring</Label>
              <div className="text-sm text-muted-foreground">
                Repeat this maintenance window automatically
              </div>
            </div>
            <Switch
              id="recurring"
              checked={recurrenceEnabled}
              onCheckedChange={setRecurrenceEnabled}
            />
          </div>

          {recurrenceEnabled && (
            <>
              <div className="space-y-2">
                <Label htmlFor="recurrence-type">Recurrence Pattern</Label>
                <Select value={recurrenceType} onValueChange={setRecurrenceType}>
                  <SelectTrigger id="recurrence-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="days">Daily</SelectItem>
                    <SelectItem value="weeks">Weekly</SelectItem>
                    <SelectItem value="months">Monthly</SelectItem>
                    <SelectItem value="years">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="custom-cron">Custom Cron (optional)</Label>
                <Input
                  id="custom-cron"
                  placeholder="0 2 1 * *"
                  value={customCron}
                  onChange={(e) => setCustomCron(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty to use the pattern above. Format: minute hour day month weekday
                </p>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
