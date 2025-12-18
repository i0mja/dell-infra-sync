import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/sla-diagnostics";

interface RPOGaugeProps {
  currentMinutes: number;
  targetMinutes: number;
  showLabels?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function RPOGauge({ 
  currentMinutes, 
  targetMinutes, 
  showLabels = true,
  size = 'md' 
}: RPOGaugeProps) {
  const percentage = Math.min((currentMinutes / targetMinutes) * 100, 200);
  const isWithinSLA = currentMinutes <= targetMinutes;
  const overdueMinutes = Math.max(0, currentMinutes - targetMinutes);

  // Determine status color
  const getStatusColor = () => {
    if (percentage <= 100) return 'bg-green-500';
    if (percentage <= 150) return 'bg-amber-500';
    return 'bg-destructive';
  };

  const getStatusTextColor = () => {
    if (percentage <= 100) return 'text-green-600';
    if (percentage <= 150) return 'text-amber-600';
    return 'text-destructive';
  };

  const sizeClasses = {
    sm: { bar: 'h-1.5', text: 'text-xs' },
    md: { bar: 'h-2', text: 'text-sm' },
    lg: { bar: 'h-3', text: 'text-base' },
  };

  return (
    <div className="space-y-2">
      {/* Progress bar */}
      <div className="relative">
        <div className={cn("w-full rounded-full bg-muted overflow-hidden", sizeClasses[size].bar)}>
          {/* Green zone (0-100%) */}
          <div 
            className="absolute inset-y-0 left-0 bg-green-500/20"
            style={{ width: '50%' }}
          />
          {/* Yellow zone (100-150%) */}
          <div 
            className="absolute inset-y-0 bg-amber-500/20"
            style={{ left: '50%', width: '25%' }}
          />
          {/* Red zone (150%+) */}
          <div 
            className="absolute inset-y-0 right-0 bg-destructive/20"
            style={{ width: '25%' }}
          />
          {/* Actual progress */}
          <div 
            className={cn("h-full rounded-full transition-all duration-500", getStatusColor())}
            style={{ width: `${Math.min(percentage / 2, 100)}%` }}
          />
        </div>
        {/* Target marker */}
        <div 
          className="absolute top-0 w-0.5 h-full bg-foreground/50"
          style={{ left: '50%' }}
        />
      </div>

      {/* Labels */}
      {showLabels && (
        <div className="flex items-center justify-between">
          <div className={cn("font-medium", sizeClasses[size].text, getStatusTextColor())}>
            {formatDuration(currentMinutes)}
          </div>
          <div className={cn("text-muted-foreground", sizeClasses[size].text)}>
            Target: {formatDuration(targetMinutes)}
          </div>
        </div>
      )}

      {/* Overdue message */}
      {!isWithinSLA && showLabels && (
        <p className={cn("text-destructive font-medium", sizeClasses[size].text)}>
          Overdue by {formatDuration(overdueMinutes)}
        </p>
      )}
    </div>
  );
}
