import { CheckCircle2, XCircle, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { Database } from '@/integrations/supabase/types';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

type IdracCommand = Database['public']['Tables']['idrac_commands']['Row'];

interface RecentActivityItemProps {
  command: IdracCommand;
  onClick: () => void;
}

export function RecentActivityItem({ command, onClick }: RecentActivityItemProps) {
  const isSuccess = command.success && command.status_code && command.status_code >= 200 && command.status_code < 300;
  const isError = !command.success || (command.status_code && command.status_code >= 400);
  
  const timeAgo = formatDistanceToNow(new Date(command.timestamp), { addSuffix: true });
  
  const truncateEndpoint = (endpoint: string) => {
    if (endpoint.length <= 40) return endpoint;
    return endpoint.substring(0, 37) + '...';
  };
  
  return (
    <div
      className="flex items-start gap-3 p-2 rounded-lg hover:bg-accent/50 cursor-pointer transition-colors"
      onClick={onClick}
    >
      <div className={cn(
        "mt-0.5 rounded-full p-1",
        isSuccess ? "bg-success/10" : isError ? "bg-destructive/10" : "bg-muted"
      )}>
        {isSuccess ? (
          <CheckCircle2 className="h-3 w-3 text-success" />
        ) : isError ? (
          <XCircle className="h-3 w-3 text-destructive" />
        ) : (
          <Clock className="h-3 w-3 text-muted-foreground" />
        )}
      </div>
      
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{timeAgo}</span>
          {command.response_time_ms && (
            <span className="text-xs text-muted-foreground">
              {command.response_time_ms}ms
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs font-mono">
            {command.operation_type}
          </Badge>
          <span className="text-xs text-muted-foreground truncate">
            {truncateEndpoint(command.endpoint)}
          </span>
        </div>
        
        {command.command_type && (
          <p className="text-xs text-foreground">
            {command.command_type}
          </p>
        )}
        
        {isError && command.error_message && (
          <p className="text-xs text-destructive truncate">
            {command.error_message}
          </p>
        )}
      </div>
    </div>
  );
}
