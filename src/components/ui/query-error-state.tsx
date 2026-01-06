import { AlertCircle, RefreshCw, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

export interface QueryErrorStateProps {
  error: any;
  onRetry?: () => void;
  isRetrying?: boolean;
  retryCount?: number;
  className?: string;
  compact?: boolean;
}

/**
 * User-friendly error state component for failed queries
 * Shows appropriate messaging for timeouts vs other errors
 */
export function QueryErrorState({
  error,
  onRetry,
  isRetrying = false,
  retryCount = 0,
  className,
  compact = false,
}: QueryErrorStateProps) {
  const isTimeout = error?.message?.includes('504') || 
                    error?.message?.includes('timeout') ||
                    error?.message?.includes('Gateway Timeout');
  
  const isNetworkError = error?.message?.includes('Failed to fetch') ||
                         error?.message?.includes('NetworkError') ||
                         error?.message?.includes('network');

  if (isRetrying) {
    return (
      <div className={cn("flex items-center gap-2 text-muted-foreground text-sm", className)}>
        <RefreshCw className="h-4 w-4 animate-spin" />
        <span>
          {isTimeout || isNetworkError 
            ? 'Connection timeout, retrying...' 
            : 'Retrying...'}
          {retryCount > 0 && ` (attempt ${retryCount + 1})`}
        </span>
      </div>
    );
  }

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        {isNetworkError ? (
          <WifiOff className="h-4 w-4 text-destructive" />
        ) : (
          <AlertCircle className="h-4 w-4 text-destructive" />
        )}
        <span className="text-sm text-muted-foreground">
          {isNetworkError ? 'Network error' : isTimeout ? 'Request timeout' : 'Failed to load'}
        </span>
        {onRetry && (
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={onRetry}
            className="h-6 px-2 text-xs"
          >
            Retry
          </Button>
        )}
      </div>
    );
  }

  return (
    <Alert variant="destructive" className={cn("", className)}>
      {isNetworkError ? (
        <WifiOff className="h-4 w-4" />
      ) : (
        <AlertCircle className="h-4 w-4" />
      )}
      <AlertTitle>
        {isNetworkError 
          ? 'Connection Error' 
          : isTimeout 
            ? 'Request Timeout' 
            : 'Failed to Load'}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span>
          {isNetworkError 
            ? 'Unable to connect to the server. Please check your network connection.'
            : isTimeout 
              ? 'The server took too long to respond. This may be due to high load.'
              : 'An error occurred while loading data.'}
        </span>
        {onRetry && (
          <Button 
            variant="outline" 
            size="sm" 
            onClick={onRetry}
            className="w-fit"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Try Again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

/**
 * Inline retry indicator for use within tables or lists
 */
export function InlineRetryIndicator({ 
  isRetrying, 
  retryCount 
}: { 
  isRetrying: boolean; 
  retryCount: number;
}) {
  if (!isRetrying) return null;

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <RefreshCw className="h-3 w-3 animate-spin" />
      Retrying{retryCount > 0 && ` (${retryCount})`}...
    </span>
  );
}
