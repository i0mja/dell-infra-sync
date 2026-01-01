import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Bell, Mail, MessageSquare, PlayCircle, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface TriggerSettings {
  toast_level: string;
  notify_on_job_started: boolean;
  notify_on_job_complete: boolean;
  notify_on_job_failed: boolean;
}

interface NotificationTriggersCardProps {
  settings: TriggerSettings;
  onChange: (settings: Partial<TriggerSettings>) => void;
  onSave: () => Promise<void>;
  isSaving: boolean;
  hasExternalChannels: boolean;
}

export function NotificationTriggersCard({
  settings,
  onChange,
  onSave,
  isSaving,
  hasExternalChannels,
}: NotificationTriggersCardProps) {
  return (
    <div className="space-y-6">
      {/* In-App Toast Notifications */}
      <Card className="border-border/50">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Bell className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">In-App Notifications</CardTitle>
              <CardDescription>
                Toast notifications that appear in the browser
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="toast_level">Notification Level</Label>
            <Select
              value={settings.toast_level || 'info'}
              onValueChange={(value) => onChange({ toast_level: value })}
            >
              <SelectTrigger id="toast_level" className="w-full md:w-[280px]">
                <SelectValue placeholder="Select level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  <div className="flex items-center gap-2">
                    <span>All Events</span>
                    <span className="text-xs text-muted-foreground">– info, warnings, and errors</span>
                  </div>
                </SelectItem>
                <SelectItem value="info">
                  <div className="flex items-center gap-2">
                    <span>Info & Above</span>
                    <span className="text-xs text-muted-foreground">– important updates only</span>
                  </div>
                </SelectItem>
                <SelectItem value="warning">
                  <div className="flex items-center gap-2">
                    <span>Warnings & Errors</span>
                    <span className="text-xs text-muted-foreground">– skip routine updates</span>
                  </div>
                </SelectItem>
                <SelectItem value="error">
                  <div className="flex items-center gap-2">
                    <span>Errors Only</span>
                    <span className="text-xs text-muted-foreground">– minimal interruption</span>
                  </div>
                </SelectItem>
                <SelectItem value="none">
                  <div className="flex items-center gap-2">
                    <span>Disabled</span>
                    <span className="text-xs text-muted-foreground">– no toast notifications</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Controls which events trigger browser toast notifications
            </p>
          </div>
        </CardContent>
      </Card>

      {/* External Notification Triggers */}
      <Card className="border-border/50">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex -space-x-1">
              <div className="p-1.5 rounded-lg bg-blue-500/10 border-2 border-background">
                <Mail className="h-4 w-4 text-blue-500" />
              </div>
              <div className="p-1.5 rounded-lg bg-purple-500/10 border-2 border-background">
                <MessageSquare className="h-4 w-4 text-purple-500" />
              </div>
            </div>
            <div>
              <CardTitle className="text-base">External Notification Triggers</CardTitle>
              <CardDescription>
                When to send Email and Teams notifications
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-1">
          {!hasExternalChannels && (
            <div className="p-3 mb-4 rounded-lg bg-muted/50 text-sm text-muted-foreground">
              Configure at least one external channel (Email or Teams) to enable these triggers.
            </div>
          )}

          <div className="divide-y">
            {/* Job Started */}
            <div className="flex items-center justify-between py-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <PlayCircle className="h-4 w-4 text-blue-500" />
                </div>
                <div>
                  <Label className="text-sm font-medium">Job Started</Label>
                  <p className="text-xs text-muted-foreground">
                    Notify when a job begins execution
                  </p>
                </div>
              </div>
              <Switch
                checked={settings.notify_on_job_started}
                onCheckedChange={(checked) => onChange({ notify_on_job_started: checked })}
                disabled={!hasExternalChannels}
              />
            </div>

            {/* Job Completed */}
            <div className="flex items-center justify-between py-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                </div>
                <div>
                  <Label className="text-sm font-medium">Job Completed</Label>
                  <p className="text-xs text-muted-foreground">
                    Notify when a job finishes successfully
                  </p>
                </div>
              </div>
              <Switch
                checked={settings.notify_on_job_complete}
                onCheckedChange={(checked) => onChange({ notify_on_job_complete: checked })}
                disabled={!hasExternalChannels}
              />
            </div>

            {/* Job Failed */}
            <div className="flex items-center justify-between py-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-red-500/10">
                  <XCircle className="h-4 w-4 text-red-500" />
                </div>
                <div>
                  <Label className="text-sm font-medium">Job Failed</Label>
                  <p className="text-xs text-muted-foreground">
                    Notify when a job encounters an error
                  </p>
                </div>
              </div>
              <Switch
                checked={settings.notify_on_job_failed}
                onCheckedChange={(checked) => onChange({ notify_on_job_failed: checked })}
                disabled={!hasExternalChannels}
              />
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t">
            <Button onClick={onSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save Changes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
