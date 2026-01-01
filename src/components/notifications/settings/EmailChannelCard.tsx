import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Mail, ChevronDown, ChevronUp, Loader2, CheckCircle2, XCircle, Send } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface EmailConfig {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_password: string;
  smtp_from_email: string;
}

interface EmailChannelCardProps {
  config: EmailConfig;
  enabled: boolean;
  onConfigChange: (config: Partial<EmailConfig>) => void;
  onEnabledChange: (enabled: boolean) => void;
  onSave: () => Promise<void>;
  isSaving: boolean;
}

export function EmailChannelCard({
  config,
  enabled,
  onConfigChange,
  onEnabledChange,
  onSave,
  isSaving,
}: EmailChannelCardProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(enabled);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);

  const isConfigured = !!(config.smtp_host && config.smtp_port && config.smtp_user && config.smtp_from_email);

  const handleTest = async () => {
    if (!isConfigured) {
      toast({
        title: 'Configuration incomplete',
        description: 'Please fill in all SMTP fields before testing',
        variant: 'destructive',
      });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const { error } = await supabase.functions.invoke('send-notification', {
        body: {
          type: 'email',
          test: true,
          to: config.smtp_from_email,
          subject: 'Test Notification',
          body: 'This is a test email from your notification system.',
        },
      });

      if (error) throw error;

      setTestResult('success');
      toast({
        title: 'Test email sent',
        description: `Check ${config.smtp_from_email} for the test message`,
      });
    } catch (error) {
      setTestResult('error');
      toast({
        title: 'Test failed',
        description: error instanceof Error ? error.message : 'Failed to send test email',
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
                <Mail className={`h-5 w-5 ${enabled && isConfigured ? 'text-green-500' : 'text-muted-foreground'}`} />
              </div>
              <div>
                <CardTitle className="text-base">Email Notifications</CardTitle>
                <CardDescription className="text-xs">
                  Send notifications via SMTP email server
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
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="smtp_host">SMTP Host</Label>
                <Input
                  id="smtp_host"
                  placeholder="smtp.example.com"
                  value={config.smtp_host || ''}
                  onChange={(e) => onConfigChange({ smtp_host: e.target.value })}
                  disabled={!enabled}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtp_port">SMTP Port</Label>
                <Input
                  id="smtp_port"
                  type="number"
                  placeholder="587"
                  value={config.smtp_port || ''}
                  onChange={(e) => onConfigChange({ smtp_port: parseInt(e.target.value) || 587 })}
                  disabled={!enabled}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="smtp_user">Username</Label>
                <Input
                  id="smtp_user"
                  placeholder="user@example.com"
                  value={config.smtp_user || ''}
                  onChange={(e) => onConfigChange({ smtp_user: e.target.value })}
                  disabled={!enabled}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtp_password">Password</Label>
                <Input
                  id="smtp_password"
                  type="password"
                  placeholder="••••••••"
                  value={config.smtp_password || ''}
                  onChange={(e) => onConfigChange({ smtp_password: e.target.value })}
                  disabled={!enabled}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="smtp_from">From Email Address</Label>
              <Input
                id="smtp_from"
                type="email"
                placeholder="notifications@example.com"
                value={config.smtp_from_email || ''}
                onChange={(e) => onConfigChange({ smtp_from_email: e.target.value })}
                disabled={!enabled}
              />
              <p className="text-xs text-muted-foreground">
                The email address that will appear as the sender
              </p>
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
