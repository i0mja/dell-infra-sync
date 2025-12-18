import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { 
  Clock, 
  ExternalLink, 
  Shield, 
  AlertTriangle,
  CheckCircle,
  Activity,
  Settings,
  RefreshCw
} from "lucide-react";
import { ScheduledJobConfig } from "@/lib/scheduled-jobs";

interface ScheduledJobContextPanelProps {
  jobType: string;
  config: ScheduledJobConfig;
  jobDetails?: any;
}

interface ProtectionGroupSummary {
  id: string;
  name: string;
  status: string | null;
  rpo_minutes: number | null;
  current_rpo_seconds: number | null;
  last_replication_at: string | null;
  is_enabled: boolean | null;
}

export function ScheduledJobContextPanel({ 
  jobType, 
  config, 
  jobDetails 
}: ScheduledJobContextPanelProps) {
  const navigate = useNavigate();
  const [protectionGroups, setProtectionGroups] = useState<ProtectionGroupSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (config.relatedEntity?.type === 'protection_group' || config.relatedEntity?.type === 'all') {
      fetchProtectionGroups();
    } else {
      setLoading(false);
    }
  }, [config]);

  const fetchProtectionGroups = async () => {
    try {
      const { data, error } = await supabase
        .from('protection_groups')
        .select('id, name, status, rpo_minutes, current_rpo_seconds, last_replication_at, is_enabled')
        .order('name');
      
      if (error) throw error;
      setProtectionGroups(data || []);
    } catch (error) {
      console.error('Error fetching protection groups:', error);
    } finally {
      setLoading(false);
    }
  };

  const getRpoStatus = (group: ProtectionGroupSummary) => {
    if (!group.rpo_minutes || !group.current_rpo_seconds) return 'unknown';
    const targetSeconds = group.rpo_minutes * 60;
    if (group.current_rpo_seconds <= targetSeconds) return 'compliant';
    if (group.current_rpo_seconds <= targetSeconds * 1.5) return 'warning';
    return 'violation';
  };

  const formatRpo = (seconds: number | null) => {
    if (!seconds) return 'N/A';
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${(seconds / 3600).toFixed(1)}h`;
  };

  const enabledGroups = protectionGroups.filter(g => g.is_enabled);
  const violationCount = protectionGroups.filter(g => getRpoStatus(g) === 'violation').length;
  const warningCount = protectionGroups.filter(g => getRpoStatus(g) === 'warning').length;

  return (
    <div className="space-y-4">
      {/* Schedule Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Schedule Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Run Interval</span>
            <Badge variant="outline">{config.schedule.interval}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Configurable</span>
            <Badge variant={config.schedule.configurable ? "secondary" : "outline"}>
              {config.schedule.configurable ? "Yes" : "System Managed"}
            </Badge>
          </div>
          {config.schedule.settingsPath && (
            <Button 
              variant="outline" 
              size="sm" 
              className="w-full"
              onClick={() => navigate(config.schedule.settingsPath!)}
            >
              <Settings className="h-3 w-3 mr-1" />
              Configure Schedule
            </Button>
          )}
        </CardContent>
      </Card>

      {/* What This Job Monitors */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4" />
            What This Job Monitors
          </CardTitle>
          <CardDescription className="text-xs">
            {config.description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Loading...
            </div>
          ) : (
            <>
              {(config.relatedEntity?.type === 'protection_group' || config.relatedEntity?.type === 'all') && (
                <div className="space-y-3">
                  {/* Summary Stats */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="p-2 bg-muted/50 rounded text-center">
                      <p className="text-lg font-bold">{enabledGroups.length}</p>
                      <p className="text-xs text-muted-foreground">Active</p>
                    </div>
                    <div className="p-2 bg-muted/50 rounded text-center">
                      <p className={`text-lg font-bold ${violationCount > 0 ? 'text-destructive' : ''}`}>
                        {violationCount}
                      </p>
                      <p className="text-xs text-muted-foreground">Violations</p>
                    </div>
                    <div className="p-2 bg-muted/50 rounded text-center">
                      <p className={`text-lg font-bold ${warningCount > 0 ? 'text-warning' : ''}`}>
                        {warningCount}
                      </p>
                      <p className="text-xs text-muted-foreground">Warnings</p>
                    </div>
                  </div>

                  <Separator />

                  {/* Protection Groups List */}
                  <ScrollArea className="max-h-[200px]">
                    <div className="space-y-2">
                      {protectionGroups.map((group) => {
                        const status = getRpoStatus(group);
                        return (
                          <div 
                            key={group.id} 
                            className="flex items-center justify-between p-2 bg-muted/30 rounded hover:bg-muted/50 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              {status === 'compliant' && <CheckCircle className="h-3 w-3 text-success" />}
                              {status === 'warning' && <AlertTriangle className="h-3 w-3 text-warning" />}
                              {status === 'violation' && <AlertTriangle className="h-3 w-3 text-destructive" />}
                              {status === 'unknown' && <Shield className="h-3 w-3 text-muted-foreground" />}
                              <span className="text-sm font-medium">{group.name}</span>
                              {!group.is_enabled && (
                                <Badge variant="outline" className="text-xs">Disabled</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">
                                RPO: {formatRpo(group.current_rpo_seconds)} / {group.rpo_minutes || '?'}m
                              </span>
                            </div>
                          </div>
                        );
                      })}
                      {protectionGroups.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          No protection groups configured
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {config.relatedEntity?.type === 'vcenter' && (
                <p className="text-sm text-muted-foreground">
                  Monitors vCenter servers and their inventory.
                </p>
              )}

              {config.relatedEntity?.type === 'server' && (
                <p className="text-sm text-muted-foreground">
                  Monitors server health and connectivity.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      {config.actions && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {config.actions.viewEntities && (
              <Button 
                variant="outline" 
                size="sm" 
                className="w-full justify-start"
                onClick={() => navigate(config.actions!.viewEntities!)}
              >
                <ExternalLink className="h-3 w-3 mr-2" />
                View {config.relatedEntity?.label || 'Related Items'}
              </Button>
            )}
            {config.actions.viewSettings && (
              <Button 
                variant="outline" 
                size="sm" 
                className="w-full justify-start"
                onClick={() => navigate(config.actions!.viewSettings!)}
              >
                <Settings className="h-3 w-3 mr-2" />
                Open Settings
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
