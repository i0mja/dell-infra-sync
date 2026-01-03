import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, PlayCircle, Clock, Radar } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface DiscoveryScanHeaderProps {
  status: string;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  ipRanges?: string[];
  ipCount?: number;
}

export function DiscoveryScanHeader({
  status,
  createdAt,
  startedAt,
  completedAt,
  ipRanges,
  ipCount,
}: DiscoveryScanHeaderProps) {
  const getStatusIcon = () => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-success" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-destructive" />;
      case 'running':
        return <PlayCircle className="h-5 w-5 text-primary animate-pulse" />;
      default:
        return <Clock className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getStatusBadge = () => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      completed: "secondary",
      failed: "destructive",
      running: "default",
      pending: "outline"
    };
    return (
      <Badge variant={variants[status] || "outline"} className="capitalize">
        {status}
      </Badge>
    );
  };

  const getDuration = () => {
    if (!startedAt) return null;
    const start = new Date(startedAt);
    const end = completedAt ? new Date(completedAt) : new Date();
    const seconds = Math.floor((end.getTime() - start.getTime()) / 1000);
    
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  };

  const duration = getDuration();
  const rangeLabel = ipRanges?.length 
    ? ipRanges.length === 1 
      ? ipRanges[0] 
      : `${ipRanges.length} ranges`
    : ipCount 
      ? `${ipCount} IPs`
      : 'Network scan';

  return (
    <div className="flex items-start justify-between gap-4 pb-4 border-b">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Radar className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            Discovery Scan
            {getStatusBadge()}
          </h3>
          <p className="text-sm text-muted-foreground">
            {rangeLabel}
          </p>
        </div>
      </div>
      
      <div className="text-right text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          {getStatusIcon()}
          {status === 'running' && startedAt && (
            <span>Running for {duration}</span>
          )}
          {status === 'completed' && (
            <span>Completed in {duration}</span>
          )}
          {status === 'pending' && (
            <span>Queued {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}</span>
          )}
          {status === 'failed' && (
            <span>Failed after {duration}</span>
          )}
        </div>
      </div>
    </div>
  );
}
