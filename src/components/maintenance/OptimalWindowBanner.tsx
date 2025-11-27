import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sparkles, X, Calendar } from "lucide-react";
import { format } from "date-fns";

interface OptimalWindow {
  start: string;
  end: string;
  duration_hours: number;
  confidence: 'high' | 'medium' | 'low';
  affected_clusters: string[];
  all_clusters_safe: boolean;
}

interface OptimalWindowBannerProps {
  window: OptimalWindow | null;
  onSchedule: () => void;
}

export function OptimalWindowBanner({ window, onSchedule }: OptimalWindowBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (!window || dismissed) return null;

  const confidenceColors = {
    high: "text-success",
    medium: "text-warning",
    low: "text-muted-foreground"
  };

  return (
    <Alert className="relative border-primary/50 bg-primary/5">
      <Sparkles className="h-4 w-4 text-primary" />
      <AlertDescription className="flex items-center justify-between gap-4 pr-8">
        <div className="flex-1">
          <span className="font-semibold">Recommended Maintenance Window:</span>{" "}
          {format(new Date(window.start), "MMM dd, HH:mm")} - {format(new Date(window.end), "HH:mm")}
          {" "}
          <span className={confidenceColors[window.confidence]}>
            ({window.confidence} confidence)
          </span>
          {" · "}
          {window.all_clusters_safe ? (
            <span className="text-success">All clusters safe</span>
          ) : (
            <span>{window.affected_clusters.length} clusters affected</span>
          )}
        </div>
        <Button size="sm" onClick={onSchedule}>
          <Calendar className="mr-2 h-4 w-4" />
          Schedule Now
        </Button>
      </AlertDescription>
      <Button
        variant="ghost"
        size="sm"
        className="absolute right-2 top-2 h-6 w-6 p-0"
        onClick={() => setDismissed(true)}
      >
        <X className="h-4 w-4" />
      </Button>
    </Alert>
  );
}
