import { ReactNode } from 'react';
import { settingsTokens } from './styles/settings-tokens';
import { cn } from '@/lib/utils';

interface SettingsOverviewCardProps {
  /** Health score or status display (left side) */
  healthScore?: ReactNode;
  /** Quick stat cards (2x2 or 4 columns) */
  statsGrid?: ReactNode;
  /** Alerts/warnings section */
  alerts?: ReactNode;
  /** Quick actions row */
  quickActions?: ReactNode;
  /** Additional content below */
  children?: ReactNode;
  className?: string;
}

/**
 * Standardized layout for "Overview" tabs across all settings.
 * Provides consistent slots for health scores, stats, alerts, and actions.
 */
export function SettingsOverviewCard({
  healthScore,
  statsGrid,
  alerts,
  quickActions,
  children,
  className,
}: SettingsOverviewCardProps) {
  return (
    <div className={cn(settingsTokens.sectionSpacing, className)}>
      {/* Health Score Section */}
      {healthScore && (
        <div className="mb-6">
          {healthScore}
        </div>
      )}

      {/* Stats Grid */}
      {statsGrid && (
        <div className={settingsTokens.statsGrid}>
          {statsGrid}
        </div>
      )}

      {/* Alerts Section */}
      {alerts && (
        <div className="mt-6">
          {alerts}
        </div>
      )}

      {/* Quick Actions */}
      {quickActions && (
        <div className={cn("mt-6", settingsTokens.quickActionsRow)}>
          {quickActions}
        </div>
      )}

      {/* Additional Content */}
      {children}
    </div>
  );
}

/**
 * Individual stat card for use within SettingsOverviewCard statsGrid
 */
interface StatCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  muted?: boolean;
  className?: string;
}

export function SettingsStatCard({
  label,
  value,
  icon,
  trend,
  trendValue,
  muted = false,
  className,
}: StatCardProps) {
  return (
    <div className={cn(
      "p-4 border rounded-lg",
      muted ? "bg-muted/30" : "bg-card",
      className
    )}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold">{value}</span>
        {trend && trendValue && (
          <span className={cn(
            "text-xs",
            trend === 'up' && "text-green-600",
            trend === 'down' && "text-red-600",
            trend === 'neutral' && "text-muted-foreground"
          )}>
            {trendValue}
          </span>
        )}
      </div>
    </div>
  );
}
