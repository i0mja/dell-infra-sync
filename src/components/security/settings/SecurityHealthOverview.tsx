import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useSecurityHealth } from '@/hooks/useSecurityHealth';
import { Shield, Key, FileText, AlertTriangle, CheckCircle2, XCircle, Plus, Play, Download, Loader2 } from 'lucide-react';

interface SecurityHealthOverviewProps {
  onNavigate: (section: string) => void;
}

export function SecurityHealthOverview({ onNavigate }: SecurityHealthOverviewProps) {
  const { healthData, loading } = useSecurityHealth();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-500';
    if (score >= 50) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getScoreLabel = (score: number) => {
    if (score >= 80) return 'Good';
    if (score >= 50) return 'Fair';
    return 'Needs Attention';
  };

  const hasAlerts = 
    healthData.sshKeys.expired > 0 || 
    healthData.sshKeys.expiringWithin30Days > 0 ||
    healthData.auditLogs.criticalCount > 0 ||
    !healthData.scheduledChecks.enabled;

  return (
    <div className="space-y-6">
      {/* Security Score */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Security Health Score
              </CardTitle>
              <CardDescription>Overall security posture of your infrastructure</CardDescription>
            </div>
            <div className="text-right">
              <div className={`text-4xl font-bold ${getScoreColor(healthData.securityScore)}`}>
                {healthData.securityScore}
              </div>
              <Badge variant={healthData.securityScore >= 80 ? 'default' : healthData.securityScore >= 50 ? 'secondary' : 'destructive'}>
                {getScoreLabel(healthData.securityScore)}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Progress value={healthData.securityScore} className="h-2" />
        </CardContent>
      </Card>

      {/* Alerts Section */}
      {hasAlerts && (
        <div className="space-y-3">
          {healthData.sshKeys.expired > 0 && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertTitle>Expired SSH Keys</AlertTitle>
              <AlertDescription className="flex items-center justify-between">
                <span>{healthData.sshKeys.expired} SSH key(s) have expired and should be rotated.</span>
                <Button size="sm" variant="outline" onClick={() => onNavigate('ssh-keys')}>
                  View Keys
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {healthData.sshKeys.expiringWithin30Days > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>SSH Keys Expiring Soon</AlertTitle>
              <AlertDescription className="flex items-center justify-between">
                <span>{healthData.sshKeys.expiringWithin30Days} SSH key(s) will expire within 30 days.</span>
                <Button size="sm" variant="outline" onClick={() => onNavigate('ssh-keys')}>
                  View Keys
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {healthData.auditLogs.criticalCount > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Critical Security Events</AlertTitle>
              <AlertDescription className="flex items-center justify-between">
                <span>{healthData.auditLogs.criticalCount} critical event(s) in the last 24 hours.</span>
                <Button size="sm" variant="outline" onClick={() => onNavigate('audit-logs')}>
                  View Logs
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {!healthData.scheduledChecks.enabled && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Safety Checks Disabled</AlertTitle>
              <AlertDescription className="flex items-center justify-between">
                <span>Scheduled cluster safety checks are not enabled.</span>
                <Button size="sm" variant="outline" onClick={() => onNavigate('safety-controls')}>
                  Configure
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {/* Quick Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => onNavigate('credentials')}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Credential Sets</p>
                <p className="text-2xl font-bold">{healthData.credentials.total}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {healthData.credentials.idrac} iDRAC, {healthData.credentials.esxi} ESXi
                </p>
              </div>
              <Shield className="h-8 w-8 text-muted-foreground" />
            </div>
            {healthData.credentials.hasDefault && (
              <Badge variant="secondary" className="mt-2">Default Set</Badge>
            )}
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => onNavigate('ssh-keys')}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">SSH Keys</p>
                <p className="text-2xl font-bold">{healthData.sshKeys.total}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {healthData.sshKeys.active} active, {healthData.sshKeys.expired} expired
                </p>
              </div>
              <Key className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => onNavigate('audit-logs')}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Audit Events (24h)</p>
                <p className="text-2xl font-bold">{healthData.auditLogs.last24hCount}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {healthData.auditLogs.criticalCount} critical
                </p>
              </div>
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => onNavigate('safety-controls')}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Safety Checks</p>
                <div className="flex items-center gap-2">
                  {healthData.scheduledChecks.enabled ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : (
                    <XCircle className="h-5 w-5 text-muted-foreground" />
                  )}
                  <span className="text-lg font-semibold">
                    {healthData.scheduledChecks.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                {healthData.scheduledChecks.lastRunAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Last: {new Date(healthData.scheduledChecks.lastRunAt).toLocaleDateString()}
                  </p>
                )}
              </div>
              <Shield className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => onNavigate('credentials')}>
              <Plus className="h-4 w-4 mr-2" />
              Add Credential Set
            </Button>
            <Button variant="outline" onClick={() => onNavigate('ssh-keys')}>
              <Key className="h-4 w-4 mr-2" />
              Generate SSH Key
            </Button>
            <Button variant="outline" onClick={() => onNavigate('safety-controls')}>
              <Play className="h-4 w-4 mr-2" />
              Run Safety Check
            </Button>
            <Button variant="outline" onClick={() => onNavigate('audit-logs')}>
              <Download className="h-4 w-4 mr-2" />
              Export Audit Logs
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
