import { Card, CardContent } from "@/components/ui/card";
import { Clock } from "lucide-react";

interface JobTimingCardProps {
  job: {
    created_at: string;
    started_at: string | null;
    completed_at: string | null;
  };
}

export const JobTimingCard = ({ job }: JobTimingCardProps) => {
  const getDuration = () => {
    if (!job.started_at) return null;
    const start = new Date(job.started_at).getTime();
    const end = job.completed_at ? new Date(job.completed_at).getTime() : Date.now();
    const durationMs = end - start;
    const seconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const duration = getDuration();

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Created:</span>
            <p className="font-medium">{new Date(job.created_at).toLocaleString()}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Started:</span>
            <p className="font-medium">
              {job.started_at ? new Date(job.started_at).toLocaleString() : "Not started"}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Completed:</span>
            <p className="font-medium">
              {job.completed_at ? new Date(job.completed_at).toLocaleString() : "-"}
            </p>
          </div>
          {duration && (
            <div>
              <span className="text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Duration:
              </span>
              <p className="font-medium">{duration}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
