import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Mail, MessageSquare, Bell, CheckCircle2, XCircle, AlertCircle, ArrowRight } from 'lucide-react';

interface NotificationStats {
  sent24h: number;
  delivered24h: number;
  failed24h: number;
}

interface NotificationHealthOverviewProps {
  emailConfigured: boolean;
  teamsConfigured: boolean;
  toastLevel: string;
  stats: NotificationStats;
  onNavigateToChannels: () => void;
  onNavigateToTriggers: () => void;
}

export function NotificationHealthOverview({
  emailConfigured,
  teamsConfigured,
  toastLevel,
  stats,
  onNavigateToChannels,
  onNavigateToTriggers,
}: NotificationHealthOverviewProps) {
  const hasAnyChannel = emailConfigured || teamsConfigured;

  return (
    <div className="space-y-6">
      {/* Quick Status Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Email Channel Status */}
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`p-2 rounded-lg ${emailConfigured ? 'bg-green-500/10' : 'bg-muted'}`}>
                  <Mail className={`h-4 w-4 ${emailConfigured ? 'text-green-500' : 'text-muted-foreground'}`} />
                </div>
                <CardTitle className="text-sm font-medium">Email</CardTitle>
              </div>
              <Badge variant={emailConfigured ? 'default' : 'secondary'} className={emailConfigured ? 'bg-green-500/10 text-green-600 hover:bg-green-500/20' : ''}>
                {emailConfigured ? 'Configured' : 'Not Set'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {emailConfigured 
                ? 'SMTP server is configured and ready to send notifications'
                : 'Configure SMTP settings to enable email notifications'}
            </p>
            {!emailConfigured && (
              <Button variant="link" size="sm" className="px-0 mt-1 h-auto text-xs" onClick={onNavigateToChannels}>
                Configure now <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Teams Channel Status */}
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`p-2 rounded-lg ${teamsConfigured ? 'bg-green-500/10' : 'bg-muted'}`}>
                  <MessageSquare className={`h-4 w-4 ${teamsConfigured ? 'text-green-500' : 'text-muted-foreground'}`} />
                </div>
                <CardTitle className="text-sm font-medium">Teams</CardTitle>
              </div>
              <Badge variant={teamsConfigured ? 'default' : 'secondary'} className={teamsConfigured ? 'bg-green-500/10 text-green-600 hover:bg-green-500/20' : ''}>
                {teamsConfigured ? 'Configured' : 'Not Set'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {teamsConfigured 
                ? 'Teams webhook is configured and ready to post messages'
                : 'Add a webhook URL to enable Teams notifications'}
            </p>
            {!teamsConfigured && (
              <Button variant="link" size="sm" className="px-0 mt-1 h-auto text-xs" onClick={onNavigateToChannels}>
                Configure now <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            )}
          </CardContent>
        </Card>

        {/* In-App Toast Status */}
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Bell className="h-4 w-4 text-primary" />
                </div>
                <CardTitle className="text-sm font-medium">In-App</CardTitle>
              </div>
              <Badge variant="outline" className="capitalize">
                {toastLevel || 'Info'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Toast notifications display for {toastLevel === 'error' ? 'errors only' : toastLevel === 'warning' ? 'warnings and errors' : 'all events'}
            </p>
            <Button variant="link" size="sm" className="px-0 mt-1 h-auto text-xs" onClick={onNavigateToTriggers}>
              Adjust level <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* 24h Statistics */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base">Last 24 Hours</CardTitle>
          <CardDescription>Notification delivery statistics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <div className="p-2 rounded-full bg-blue-500/10">
                <Bell className="h-4 w-4 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{stats.sent24h}</p>
                <p className="text-xs text-muted-foreground">Total Sent</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <div className="p-2 rounded-full bg-green-500/10">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{stats.delivered24h}</p>
                <p className="text-xs text-muted-foreground">Delivered</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <div className="p-2 rounded-full bg-red-500/10">
                <XCircle className="h-4 w-4 text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{stats.failed24h}</p>
                <p className="text-xs text-muted-foreground">Failed</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Setup Guidance */}
      {!hasAnyChannel && (
        <Card className="border-dashed border-2 border-muted-foreground/25 bg-muted/30">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">Get Started with Notifications</CardTitle>
            </div>
            <CardDescription>
              No external notification channels are configured yet. Follow these steps to enable notifications.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium">
                  1
                </div>
                <div>
                  <p className="text-sm font-medium">Choose a notification channel</p>
                  <p className="text-xs text-muted-foreground">Configure Email (SMTP) or Microsoft Teams webhooks</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium">
                  2
                </div>
                <div>
                  <p className="text-sm font-medium">Test the connection</p>
                  <p className="text-xs text-muted-foreground">Verify your credentials work before enabling triggers</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium">
                  3
                </div>
                <div>
                  <p className="text-sm font-medium">Configure notification triggers</p>
                  <p className="text-xs text-muted-foreground">Choose which events should send notifications</p>
                </div>
              </div>
            </div>
            <Button className="mt-4" onClick={onNavigateToChannels}>
              Configure Channels
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
