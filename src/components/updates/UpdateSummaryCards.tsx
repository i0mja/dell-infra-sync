import { Card, CardContent } from '@/components/ui/card';
import { 
  Server, 
  AlertTriangle, 
  CheckCircle2, 
  Download, 
  HardDrive,
  AlertCircle,
  Clock
} from 'lucide-react';
import type { ScanSummary } from './types';

interface UpdateSummaryCardsProps {
  summary: ScanSummary;
  isLoading?: boolean;
}

interface StatCardProps {
  title: string;
  value: number | string;
  subtitle?: string;
  icon: React.ElementType;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}

function StatCard({ title, value, subtitle, icon: Icon, variant = 'default' }: StatCardProps) {
  const variantStyles = {
    default: 'bg-muted/50 text-foreground',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    danger: 'bg-destructive/10 text-destructive',
    info: 'bg-primary/10 text-primary',
  };

  const iconBgStyles = {
    default: 'bg-muted',
    success: 'bg-success/20',
    warning: 'bg-warning/20',
    danger: 'bg-destructive/20',
    info: 'bg-primary/20',
  };

  return (
    <Card className={`${variantStyles[variant]} border-0`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
            )}
          </div>
          <div className={`p-2 rounded-lg ${iconBgStyles[variant]}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function UpdateSummaryCards({ summary, isLoading }: UpdateSummaryCardsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-4 h-24" />
          </Card>
        ))}
      </div>
    );
  }

  const successRate = summary.hostsScanned && summary.hostsScanned > 0
    ? Math.round((summary.hostsSuccessful || 0) / summary.hostsScanned * 100)
    : 0;

  const complianceRate = summary.totalComponents && summary.totalComponents > 0
    ? Math.round((summary.upToDate || 0) / summary.totalComponents * 100)
    : 0;

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">Firmware Update Summary</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard
        title="Hosts Scanned"
        value={summary.hostsScanned || 0}
        subtitle={summary.hostsFailed ? `${summary.hostsFailed} failed` : `${successRate}% success`}
        icon={Server}
        variant={summary.hostsFailed && summary.hostsFailed > 0 ? 'warning' : 'default'}
      />
      
      <StatCard
        title="Updates Available"
        value={summary.updatesAvailable || 0}
        subtitle={`across ${summary.hostsScanned || 0} hosts`}
        icon={Download}
        variant={summary.updatesAvailable && summary.updatesAvailable > 0 ? 'info' : 'success'}
      />
      
      <StatCard
        title="Critical Updates"
        value={summary.criticalUpdates || 0}
        subtitle={summary.criticalUpdates && summary.criticalUpdates > 0 
          ? 'Action required' 
          : 'No critical updates'}
        icon={AlertTriangle}
        variant={summary.criticalUpdates && summary.criticalUpdates > 0 ? 'danger' : 'success'}
      />
      
      <StatCard
        title="Components Current"
        value={summary.upToDate || 0}
        subtitle={`${complianceRate}% up to date`}
        icon={CheckCircle2}
        variant={complianceRate >= 90 ? 'success' : complianceRate >= 70 ? 'warning' : 'danger'}
      />
      </div>
    </div>
  );
}

interface EsxiSummaryCardProps {
  esxiUpdatesAvailable: number;
  totalHosts: number;
}

export function EsxiSummaryCard({ esxiUpdatesAvailable, totalHosts }: EsxiSummaryCardProps) {
  const upToDateHosts = totalHosts - esxiUpdatesAvailable;
  
  return (
    <Card className={esxiUpdatesAvailable > 0 ? 'bg-warning/10 border-warning/20' : 'bg-success/10 border-success/20'}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${esxiUpdatesAvailable > 0 ? 'bg-warning/20' : 'bg-success/20'}`}>
              <HardDrive className={`h-5 w-5 ${esxiUpdatesAvailable > 0 ? 'text-warning' : 'text-success'}`} />
            </div>
            <div>
              <p className="font-medium">ESXi Updates</p>
              <p className="text-sm text-muted-foreground">
                {esxiUpdatesAvailable > 0 
                  ? `${esxiUpdatesAvailable} host(s) need updating`
                  : 'All hosts are up to date'}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold">{upToDateHosts}/{totalHosts}</p>
            <p className="text-xs text-muted-foreground">Current</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
