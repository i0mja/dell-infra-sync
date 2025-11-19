import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Calendar, Clock, Server } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface OptimalWindow {
  start: string;
  end: string;
  duration_hours: number;
  confidence: 'high' | 'medium' | 'low';
  all_clusters_safe: boolean;
  affected_clusters: string[];
  avg_healthy_hosts: number;
  avg_total_hosts: number;
}

interface OptimalWindowsSidebarProps {
  windows: OptimalWindow[];
  onSchedule: (window: OptimalWindow) => void;
  loading: boolean;
}

export function OptimalWindowsSidebar({ 
  windows, 
  onSchedule,
  loading 
}: OptimalWindowsSidebarProps) {
  
  const getConfidenceVariant = (confidence: string) => {
    switch (confidence) {
      case 'high': return 'default';
      case 'medium': return 'secondary';
      case 'low': return 'outline';
      default: return 'secondary';
    }
  };

  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case 'high': return 'text-green-600 dark:text-green-400';
      case 'medium': return 'text-yellow-600 dark:text-yellow-400';
      case 'low': return 'text-orange-600 dark:text-orange-400';
      default: return 'text-gray-600';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          Optimal Maintenance Windows
        </CardTitle>
        <CardDescription>
          AI-powered recommendations based on historical cluster safety data
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            Analyzing cluster safety patterns...
          </div>
        ) : windows.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            No optimal windows found. Run more safety checks to build recommendations.
          </div>
        ) : (
          windows.map((window, idx) => (
            <div key={idx} className="p-3 border rounded-lg space-y-3 hover:bg-accent/50 transition-colors">
              <div className="flex items-center justify-between">
                <Badge variant={getConfidenceVariant(window.confidence)} className={getConfidenceColor(window.confidence)}>
                  {window.confidence.toUpperCase()} CONFIDENCE
                </Badge>
                <span className="text-xs text-muted-foreground font-medium">
                  {Math.round(window.duration_hours)}h window
                </span>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <Calendar className="h-4 w-4 mt-0.5 text-muted-foreground" />
                  <div className="text-sm">
                    <div className="font-medium">
                      {format(new Date(window.start), 'MMM dd, yyyy')}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {format(new Date(window.start), 'HH:mm')} - {format(new Date(window.end), 'HH:mm')}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>Starts {formatDistanceToNow(new Date(window.start), { addSuffix: true })}</span>
                </div>
                
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Server className="h-3 w-3" />
                  <span>
                    {window.affected_clusters.length} cluster{window.affected_clusters.length > 1 ? 's' : ''} available
                  </span>
                </div>
                
                {window.all_clusters_safe && (
                  <div className="text-xs text-green-600 dark:text-green-400 font-medium">
                    ✓ All clusters safe
                  </div>
                )}
              </div>
              
              <Button 
                size="sm" 
                className="w-full"
                onClick={() => onSchedule(window)}
              >
                Schedule Maintenance
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
