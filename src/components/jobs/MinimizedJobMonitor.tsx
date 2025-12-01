import { createPortal } from 'react-dom';
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, Maximize2, X } from "lucide-react";
import { useJobProgress } from "@/hooks/useJobProgress";
import { useEffect, useState } from "react";

interface MinimizedJobMonitorProps {
  jobId: string;
  jobType: string;
  onMaximize: () => void;
  onClose: () => void;
}

export const MinimizedJobMonitor = ({ 
  jobId, 
  jobType,
  onMaximize, 
  onClose 
}: MinimizedJobMonitorProps) => {
  const [isMounted, setIsMounted] = useState(false);
  const { data: progress } = useJobProgress(jobId, true);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const getJobTypeLabel = (type: string) => {
    return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  // Don't render until mounted to avoid portal context issues
  if (!isMounted) {
    return null;
  }

  return createPortal(
    <Card className="fixed bottom-4 right-4 w-80 shadow-lg z-50 border-2">
      <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm font-medium">{getJobTypeLabel(jobType)}</span>
        </div>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onMaximize}>
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        <Progress value={progress?.progressPercent || 0} className="h-2" />
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {progress?.currentStep || 'Processing...'}
          </p>
          {progress?.elapsedMs && (
            <p className="text-xs text-muted-foreground">
              Elapsed: {Math.floor(progress.elapsedMs / 1000)}s
            </p>
          )}
          {progress?.totalTasks && progress.totalTasks > 0 && (
            <p className="text-xs text-muted-foreground">
              Tasks: {progress.completedTasks}/{progress.totalTasks}
            </p>
          )}
        </div>
      </CardContent>
    </Card>,
    document.body
  );
};
