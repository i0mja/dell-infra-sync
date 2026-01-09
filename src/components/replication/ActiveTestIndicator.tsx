import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FlaskConical, Clock, StopCircle, Loader2 } from "lucide-react";
import { formatDistanceToNowStrict, differenceInMinutes, differenceInSeconds } from "date-fns";
import { useFailoverOperations } from "@/hooks/useFailoverOperations";

interface ActiveTestIndicatorProps {
  groupId: string;
  eventId: string;
  cleanupScheduledAt?: string | null;
  testDurationMinutes?: number | null;
  startedAt?: string | null;
}

export function ActiveTestIndicator({
  groupId,
  eventId,
  cleanupScheduledAt,
  testDurationMinutes,
  startedAt,
}: ActiveTestIndicatorProps) {
  const { rollbackFailover } = useFailoverOperations(groupId);
  const [timeRemaining, setTimeRemaining] = useState<string>("");
  const [isEnding, setIsEnding] = useState(false);

  useEffect(() => {
    if (!cleanupScheduledAt) return;

    const updateTimeRemaining = () => {
      const cleanupTime = new Date(cleanupScheduledAt);
      const now = new Date();
      const diffSeconds = differenceInSeconds(cleanupTime, now);
      
      if (diffSeconds <= 0) {
        setTimeRemaining("Cleanup pending...");
        return;
      }
      
      const hours = Math.floor(diffSeconds / 3600);
      const minutes = Math.floor((diffSeconds % 3600) / 60);
      const seconds = diffSeconds % 60;
      
      if (hours > 0) {
        setTimeRemaining(`${hours}h ${minutes}m remaining`);
      } else if (minutes > 0) {
        setTimeRemaining(`${minutes}m ${seconds}s remaining`);
      } else {
        setTimeRemaining(`${seconds}s remaining`);
      }
    };

    updateTimeRemaining();
    const interval = setInterval(updateTimeRemaining, 1000);
    return () => clearInterval(interval);
  }, [cleanupScheduledAt]);

  const handleEndNow = async () => {
    if (!confirm("End this test failover now? DR VMs will be powered off.")) return;
    
    setIsEnding(true);
    try {
      await rollbackFailover.mutateAsync({ eventId, protectionGroupId: groupId });
    } finally {
      setIsEnding(false);
    }
  };

  return (
    <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-blue-500" />
          <span className="text-sm font-medium">Test in Progress</span>
          {startedAt && (
            <Badge variant="outline" className="text-xs">
              Started {formatDistanceToNowStrict(new Date(startedAt), { addSuffix: true })}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {cleanupScheduledAt && (
            <div className="flex items-center gap-1 text-xs text-blue-600">
              <Clock className="h-3 w-3" />
              <span>{timeRemaining}</span>
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={handleEndNow}
            disabled={isEnding || rollbackFailover.isPending}
            className="h-7 text-xs"
          >
            {isEnding || rollbackFailover.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <StopCircle className="h-3 w-3 mr-1" />
            )}
            End Now
          </Button>
        </div>
      </div>
      {testDurationMinutes && (
        <p className="text-xs text-muted-foreground mt-1">
          Scheduled duration: {testDurationMinutes} minutes
        </p>
      )}
    </div>
  );
}