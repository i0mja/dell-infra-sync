import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MessageSquare, ChevronDown, ChevronUp, Loader2, CheckCircle2, XCircle, Send } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface TeamsConfig {
  teams_webhook_url: string;
  teams_mention_users: string;
  mention_on_critical_failures: boolean;
}

interface TeamsChannelCardProps {
  config: TeamsConfig;
  enabled: boolean;
  onConfigChange: (config: Partial<TeamsConfig>) => void;
  onEnabledChange: (enabled: boolean) => void;
  onSave: () => Promise<void>;
  isSaving: boolean;
}

export function TeamsChannelCard({
  config,
  enabled,
  onConfigChange,
  onEnabledChange,
  onSave,
  isSaving,
}: TeamsChannelCardProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(enabled);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);

  const isConfigured = !!config.teams_webhook_url;

  const handleTest = async () => {
    if (!isConfigured) {
      toast({
        title: 'Configuration incomplete',
        description: 'Please enter a webhook URL before testing',
        variant: 'destructive',
      });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const { error } = await supabase.functions.invoke('send-teams-notification', {
        body: {
          test: true,
        },
      });

      if (error) throw error;

      setTestResult('success');
      toast({
        title: 'Test message sent',
        description: 'Check your Teams channel for the test notification',
      });
    } catch (error) {
      setTestResult('error');
      toast({
        title: 'Test failed',
        description: error instanceof Error ? error.message : 'Failed to send test message',
        variant: 'destructive',
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Card className="border-border/50">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${enabled && isConfigured ? 'bg-green-500/10' : 'bg-muted'}`}>
                <MessageSquare className={`h-5 w-5 ${enabled && isConfigured ? 'text-green-500' : 'text-muted-foreground'}`} />
              </div>
              <div>
                <CardTitle className="text-base">Microsoft Teams</CardTitle>
                <CardDescription className="text-xs">
                  Post notifications to a Teams channel via webhook
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={isConfigured ? (enabled ? 'default' : 'secondary') : 'outline'} className={isConfigured && enabled ? 'bg-green-500/10 text-green-600' : ''}>
                {isConfigured ? (enabled ? 'Active' : 'Disabled') : 'Not Configured'}
              </Badge>
              <Switch
                checked={enabled}
                onCheckedChange={(checked) => {
                  onEnabledChange(checked);
                  if (checked) setIsOpen(true);
                }}
              />
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="teams_webhook">Webhook URL</Label>
              <Input
                id="teams_webhook"
                type="url"
                placeholder="https://outlook.office.com/webhook/..."
                value={config.teams_webhook_url || ''}
                onChange={(e) => onConfigChange({ teams_webhook_url: e.target.value })}
                disabled={!enabled}
              />
              <p className="text-xs text-muted-foreground">
                Create an incoming webhook in your Teams channel settings
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="teams_mentions">Mention Users (Optional)</Label>
              <Input
                id="teams_mentions"
                placeholder="user@example.com, user2@example.com"
                value={config.teams_mention_users || ''}
                onChange={(e) => onConfigChange({ teams_mention_users: e.target.value })}
                disabled={!enabled}
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated list of user emails to mention in notifications
              </p>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div className="space-y-0.5">
                <Label htmlFor="critical_mentions" className="text-sm font-medium">
                  Mention on Critical Failures
                </Label>
                <p className="text-xs text-muted-foreground">
                  @mention users when critical jobs fail
                </p>
              </div>
              <Switch
                id="critical_mentions"
                checked={config.mention_on_critical_failures}
                onCheckedChange={(checked) => onConfigChange({ mention_on_critical_failures: checked })}
                disabled={!enabled}
              />
            </div>

            <div className="flex items-center justify-between pt-2 border-t">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTest}
                  disabled={!enabled || !isConfigured || isTesting}
                >
                  {isTesting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  Test Connection
                </Button>
                {testResult === 'success' && (
                  <span className="flex items-center text-xs text-green-600">
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Test passed
                  </span>
                )}
                {testResult === 'error' && (
                  <span className="flex items-center text-xs text-destructive">
                    <XCircle className="h-3 w-3 mr-1" /> Test failed
                  </span>
                )}
              </div>
              <Button onClick={onSave} disabled={isSaving || !enabled}>
                {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Save Changes
              </Button>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
