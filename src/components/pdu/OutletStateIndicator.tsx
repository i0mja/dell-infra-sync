import { cn } from '@/lib/utils';
import { Power, PowerOff, HelpCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface OutletStateIndicatorProps {
  state: 'on' | 'off' | 'unknown';
  outletNumber: number;
  outletName?: string;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

export function OutletStateIndicator({
  state,
  outletNumber,
  outletName,
  size = 'md',
  showLabel = false,
  className,
}: OutletStateIndicatorProps) {
  const sizeClasses = {
    sm: 'h-6 w-6',
    md: 'h-8 w-8',
    lg: 'h-10 w-10',
  };

  const iconSizes = {
    sm: 'h-3 w-3',
    md: 'h-4 w-4',
    lg: 'h-5 w-5',
  };

  const stateConfig = {
    on: {
      bg: 'bg-green-500/20 border-green-500/50',
      icon: Power,
      iconClass: 'text-green-400',
      label: 'On',
    },
    off: {
      bg: 'bg-muted border-muted-foreground/30',
      icon: PowerOff,
      iconClass: 'text-muted-foreground',
      label: 'Off',
    },
    unknown: {
      bg: 'bg-yellow-500/20 border-yellow-500/50',
      icon: HelpCircle,
      iconClass: 'text-yellow-400',
      label: 'Unknown',
    },
  };

  const config = stateConfig[state];
  const Icon = config.icon;
  const displayName = outletName || `Outlet ${outletNumber}`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'flex items-center gap-2',
              className
            )}
          >
            <div
              className={cn(
                'flex items-center justify-center rounded-md border',
                sizeClasses[size],
                config.bg
              )}
            >
              <Icon className={cn(iconSizes[size], config.iconClass)} />
            </div>
            {showLabel && (
              <span className="text-sm text-muted-foreground">{displayName}</span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{displayName}: {config.label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
