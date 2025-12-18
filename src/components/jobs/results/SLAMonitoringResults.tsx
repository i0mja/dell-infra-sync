import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  CheckCircle, 
  AlertTriangle, 
  Clock, 
  RefreshCw, 
  Shield, 
  ExternalLink,
  PlayCircle,
  PauseCircle,
  SkipForward
} from "lucide-react";
import { useNavigate } from "react-router-dom";

interface SLAMonitoringResultsProps {
  details: {
    groups_checked?: number;
    triggered_syncs?: string[];
    rpo_violations?: number;
    test_overdue?: number;
    skipped?: Array<{ name: string; reason: string }>;
    next_run_scheduled?: boolean;
    sync_results?: Array<{
      group_name: string;
      action: string;
      status: string;
    }>;
    cycle_duration_ms?: number;
    error?: string;
  };
  jobType: 'scheduled_replication_check' | 'rpo_monitoring';
}

export function SLAMonitoringResults({ details, jobType }: SLAMonitoringResultsProps) {
  const navigate = useNavigate();
  
  const isRpoMonitoring = jobType === 'rpo_monitoring';
  const groupsChecked = details?.groups_checked || 0;
  const triggeredSyncs = details?.triggered_syncs || [];
  const rpoViolations = details?.rpo_violations || 0;
  const testOverdue = details?.test_overdue || 0;
  const skipped = details?.skipped || [];
  const syncResults = details?.sync_results || [];
  const cycleDuration = details?.cycle_duration_ms;
  
  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              <div>
                <p className="text-2xl font-bold">{groupsChecked}</p>
                <p className="text-xs text-muted-foreground">Groups Checked</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <PlayCircle className="h-4 w-4 text-success" />
              <div>
                <p className="text-2xl font-bold">{triggeredSyncs.length}</p>
                <p className="text-xs text-muted-foreground">Syncs Triggered</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        {isRpoMonitoring && (
          <>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className={`h-4 w-4 ${rpoViolations > 0 ? 'text-destructive' : 'text-muted-foreground'}`} />
                  <div>
                    <p className="text-2xl font-bold">{rpoViolations}</p>
                    <p className="text-xs text-muted-foreground">RPO Violations</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2">
                  <Clock className={`h-4 w-4 ${testOverdue > 0 ? 'text-warning' : 'text-muted-foreground'}`} />
                  <div>
                    <p className="text-2xl font-bold">{testOverdue}</p>
                    <p className="text-xs text-muted-foreground">Tests Overdue</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
        
        {!isRpoMonitoring && (
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2">
                <SkipForward className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-2xl font-bold">{skipped.length}</p>
                  <p className="text-xs text-muted-foreground">Skipped</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Triggered Syncs */}
      {triggeredSyncs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Syncs Triggered
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {triggeredSyncs.map((sync, idx) => (
                <Badge key={idx} variant="secondary" className="font-mono">
                  {sync}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sync Results */}
      {syncResults.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              Sync Actions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[200px]">
              <div className="space-y-2">
                {syncResults.map((result, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <span className="text-sm font-medium">{result.group_name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{result.action}</span>
                      <Badge 
                        variant={result.status === 'success' ? 'secondary' : 'destructive'}
                        className="text-xs"
                      >
                        {result.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Skipped Groups */}
      {skipped.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <PauseCircle className="h-4 w-4 text-muted-foreground" />
              Skipped Groups
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[150px]">
              <div className="space-y-2">
                {skipped.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 bg-muted/30 rounded text-sm">
                    <span className="font-medium">{item.name}</span>
                    <span className="text-xs text-muted-foreground">{item.reason}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Cycle Info & Quick Actions */}
      <div className="flex items-center justify-between pt-2">
        <div className="text-xs text-muted-foreground">
          {cycleDuration && (
            <span>Cycle completed in {cycleDuration}ms</span>
          )}
        </div>
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => navigate('/replication?tab=protection-groups')}
        >
          <ExternalLink className="h-3 w-3 mr-1" />
          View Protection Groups
        </Button>
      </div>
    </div>
  );
}
