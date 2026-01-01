import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { settingsTokens } from './styles/settings-tokens';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SettingsCardProps {
  title?: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  statsBar?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Use muted background variant */
  muted?: boolean;
  /** Remove default padding */
  noPadding?: boolean;
}

/**
 * Standardized card wrapper for settings content.
 * Provides consistent padding, optional header, and stats bar slot.
 */
export function SettingsCard({
  title,
  description,
  icon: Icon,
  action,
  statsBar,
  children,
  className,
  muted = false,
  noPadding = false,
}: SettingsCardProps) {
  const hasHeader = title || description || action;

  return (
    <Card className={cn(muted && 'bg-muted/30', className)}>
      {hasHeader && (
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div className="space-y-1">
            {title && (
              <CardTitle className="flex items-center gap-2">
                {Icon && <Icon className="h-5 w-5 text-muted-foreground" />}
                {title}
              </CardTitle>
            )}
            {description && <CardDescription>{description}</CardDescription>}
          </div>
          {action && <div className="flex-shrink-0">{action}</div>}
        </CardHeader>
      )}
      
      {statsBar && (
        <div className="px-6 pb-4">
          {statsBar}
        </div>
      )}
      
      <CardContent className={cn(noPadding && 'p-0', !hasHeader && settingsTokens.cardPadding)}>
        {children}
      </CardContent>
    </Card>
  );
}
