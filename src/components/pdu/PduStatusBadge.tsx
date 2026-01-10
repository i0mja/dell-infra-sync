import { Badge } from '@/components/ui/badge';
import { Wifi, WifiOff, AlertCircle, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PduStatusBadgeProps {
  status: 'online' | 'offline' | 'unknown' | 'error';
  className?: string;
}

export function PduStatusBadge({ status, className }: PduStatusBadgeProps) {
  const config = {
    online: {
      label: 'Online',
      icon: Wifi,
      variant: 'default' as const,
      className: 'bg-green-500/20 text-green-400 border-green-500/30',
    },
    offline: {
      label: 'Offline',
      icon: WifiOff,
      variant: 'secondary' as const,
      className: 'bg-muted text-muted-foreground',
    },
    error: {
      label: 'Error',
      icon: AlertCircle,
      variant: 'destructive' as const,
      className: 'bg-destructive/20 text-destructive border-destructive/30',
    },
    unknown: {
      label: 'Unknown',
      icon: HelpCircle,
      variant: 'outline' as const,
      className: 'bg-muted/50 text-muted-foreground',
    },
  };

  const { label, icon: Icon, className: statusClassName } = config[status] || config.unknown;

  return (
    <Badge variant="outline" className={cn('gap-1', statusClassName, className)}>
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}
