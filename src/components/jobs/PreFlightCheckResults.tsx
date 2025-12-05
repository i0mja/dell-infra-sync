import { CheckCircle, XCircle, AlertTriangle, Loader2, Server, Wifi, Key, Clock, Activity, HardDrive, Globe, Settings } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { useState } from "react";
import { PreflightProgress } from "@/lib/job-executor-api";

interface IdracJob {
  id: string;
  name: string;
  job_state: string;
  percent_complete: number;
  message?: string;
  job_type?: string;
  start_time?: string;
  end_time?: string;
}

export interface ServerPreflightResult {
  server_id: string;
  hostname: string | null;
  ip_address: string | null;
  ready: boolean;
  checks: {
    connectivity: { passed: boolean; message?: string };
    auth: { passed: boolean; message?: string };
    lifecycle_controller: { passed: boolean; status?: string };
    pending_jobs: { passed: boolean; count?: number | null; jobs?: IdracJob[] };
    power_state: { passed: boolean; state?: string };
    system_health: { passed: boolean; overall?: string };
  };
  blockers: Array<{ type: string; message: string }>;
  warnings: string[];
}

export interface PreflightCheckResult {
  success: boolean;
  response_time_ms?: number;
  servers: ServerPreflightResult[];
  firmware_source_checks: {
    dns_configured?: boolean;
    dns1?: string | null;
    dns2?: string | null;
    dell_reachable?: boolean;
    dell_error?: string | null;
  };
  overall_ready: boolean;
  blockers: Array<{ server_id?: string; hostname?: string; type: string; message: string; suggestion?: string }>;
  warnings: Array<{ server_id?: string; hostname?: string; message: string }>;
  error?: string;
}

interface PreFlightCheckResultsProps {
  results: PreflightCheckResult | null;
  loading: boolean;
  firmwareSource: string;
  onChangeFirmwareSource?: (source: string) => void;
  onOpenNetworkSettings?: (serverId: string) => void;
  progress?: PreflightProgress | null;
}

const CheckIcon = ({ passed, loading }: { passed: boolean; loading?: boolean }) => {
  if (loading) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  return passed 
    ? <CheckCircle className="h-4 w-4 text-green-500" />
    : <XCircle className="h-4 w-4 text-destructive" />;
};

export function PreFlightCheckResults({ 
  results, 
  loading, 
  firmwareSource,
  onChangeFirmwareSource,
  onOpenNetworkSettings,
  progress
}: PreFlightCheckResultsProps) {
  const [expandedServers, setExpandedServers] = useState<string[]>([]);

  if (loading) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-6 space-y-4">
          {/* Progress bar with percentage */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="font-medium">Running Pre-Flight Checks...</span>
              <span className="text-muted-foreground">
                {progress ? `${progress.current}/${progress.total}` : 'Initializing...'}
              </span>
            </div>
            <Progress value={progress?.percent || 0} className="h-2" />
          </div>
          
          {/* Current server being checked */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>
              {progress?.status === 'dell_repo_check' 
                ? 'Checking Dell repository connectivity...'
                : progress?.current_hostname 
                  ? `Checking: ${progress.current_hostname}` 
                  : 'Initializing checks...'}
            </span>
          </div>
          
          {/* Running tally */}
          {progress && progress.current > 0 && (
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span>{progress.passed} passed</span>
              </div>
              <div className="flex items-center gap-1.5">
                <XCircle className="h-4 w-4 text-destructive" />
                <span>{progress.failed} failed</span>
              </div>
            </div>
          )}
          
          {/* Estimate for large clusters */}
          {progress && progress.total > 5 && (
            <p className="text-xs text-muted-foreground">
              Checking {progress.total} servers (~6 checks per server)
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  if (!results) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-8">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Activity className="h-8 w-8" />
            <p>Click "Run Pre-Flight Check" to verify server readiness</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (results.error) {
    return (
      <Alert variant="destructive">
        <XCircle className="h-4 w-4" />
        <AlertTitle>Pre-Flight Check Failed</AlertTitle>
        <AlertDescription>{results.error}</AlertDescription>
      </Alert>
    );
  }

  const toggleServer = (serverId: string) => {
    setExpandedServers(prev => 
      prev.includes(serverId) 
        ? prev.filter(id => id !== serverId)
        : [...prev, serverId]
    );
  };

  return (
    <div className="space-y-4">
      {/* Overall Status */}
      <Alert variant={results.overall_ready ? "default" : "destructive"}>
        {results.overall_ready ? (
          <CheckCircle className="h-4 w-4" />
        ) : (
          <AlertTriangle className="h-4 w-4" />
        )}
        <AlertTitle>
          {results.overall_ready ? "Pre-Flight Check Passed" : "Pre-Flight Check Failed"}
        </AlertTitle>
        <AlertDescription>
          {results.overall_ready 
            ? `All ${results.servers.length} server(s) are ready for update.`
            : `${results.blockers.length} blocker(s) must be resolved before proceeding.`}
          {results.response_time_ms && <span className="text-xs ml-2">({results.response_time_ms}ms)</span>}
        </AlertDescription>
      </Alert>

      {/* Blockers */}
      {results.blockers.length > 0 && (
        <Card className="border-destructive/50">
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-destructive">
              <XCircle className="h-4 w-4" />
              Blockers ({results.blockers.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="py-0 pb-3">
            <ul className="space-y-2">
              {results.blockers.map((blocker, idx) => (
                <li key={idx} className="text-sm flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {blocker.hostname || blocker.type}
                    </Badge>
                    <span>{blocker.message}</span>
                  </div>
                  {blocker.suggestion && (
                    <div className="flex items-center gap-2 ml-4">
                      <span className="text-xs text-muted-foreground">💡 {blocker.suggestion}</span>
                      {blocker.type === 'dell_repo_unreachable' && onChangeFirmwareSource && (
                        <Button 
                          variant="link" 
                          size="sm" 
                          className="h-auto p-0 text-xs"
                          onClick={() => onChangeFirmwareSource('local_repository')}
                        >
                          Switch to Local Repository
                        </Button>
                      )}
                      {blocker.type === 'dell_repo_unreachable' && blocker.server_id && onOpenNetworkSettings && (
                        <Button 
                          variant="link" 
                          size="sm" 
                          className="h-auto p-0 text-xs"
                          onClick={() => onOpenNetworkSettings(blocker.server_id!)}
                        >
                          Configure Network
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Warnings */}
      {results.warnings.length > 0 && (
        <Card className="border-yellow-500/50">
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-yellow-600">
              <AlertTriangle className="h-4 w-4" />
              Warnings ({results.warnings.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="py-0 pb-3">
            <ul className="space-y-1">
              {results.warnings.map((warning, idx) => (
                <li key={idx} className="text-sm flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {warning.hostname || 'System'}
                  </Badge>
                  <span>{warning.message}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Dell Repository Check (if online catalog) */}
      {firmwareSource === 'dell_online_catalog' && results.firmware_source_checks && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Dell Repository Connectivity
            </CardTitle>
          </CardHeader>
          <CardContent className="py-0 pb-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <CheckIcon passed={results.firmware_source_checks.dns_configured || false} />
                <span>DNS Configured</span>
                {results.firmware_source_checks.dns1 && (
                  <span className="text-xs text-muted-foreground">({results.firmware_source_checks.dns1})</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <CheckIcon passed={results.firmware_source_checks.dell_reachable || false} />
                <span>Dell Repository</span>
                {results.firmware_source_checks.dell_error && (
                  <span className="text-xs text-destructive">({results.firmware_source_checks.dell_error})</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Server-by-Server Results */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Server className="h-4 w-4" />
            Server Status ({results.servers.filter(s => s.ready).length}/{results.servers.length} ready)
          </CardTitle>
        </CardHeader>
        <CardContent className="py-0 pb-3">
          <div className="space-y-2">
            {results.servers.map((server) => (
              <Collapsible 
                key={server.server_id} 
                open={expandedServers.includes(server.server_id)}
                onOpenChange={() => toggleServer(server.server_id)}
              >
                <CollapsibleTrigger className="w-full">
                  <div className="flex items-center justify-between p-2 rounded hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-2">
                      {server.ready ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive" />
                      )}
                      <span className="font-medium">{server.hostname || server.ip_address}</span>
                      <span className="text-xs text-muted-foreground">{server.ip_address}</span>
                    </div>
                    <Badge variant={server.ready ? "default" : "destructive"}>
                      {server.ready ? 'Ready' : `${server.blockers.length} blocker(s)`}
                    </Badge>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="grid grid-cols-2 gap-2 p-2 pl-8 text-sm bg-muted/30 rounded-b">
                    <div className="flex items-center gap-2">
                      <CheckIcon passed={server.checks.connectivity.passed} />
                      <Wifi className="h-3 w-3" />
                      <span>Connectivity</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckIcon passed={server.checks.auth.passed} />
                      <Key className="h-3 w-3" />
                      <span>Authentication</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckIcon passed={server.checks.lifecycle_controller.passed} />
                      <Settings className="h-3 w-3" />
                      <span>Lifecycle Controller</span>
                      {server.checks.lifecycle_controller.status && (
                        <span className="text-xs text-muted-foreground">
                          ({server.checks.lifecycle_controller.status})
                        </span>
                      )}
                    </div>
                    <div className="col-span-2 space-y-2">
                      <div className="flex items-center gap-2">
                        <CheckIcon passed={server.checks.pending_jobs.passed} />
                        <Clock className="h-3 w-3" />
                        <span>Pending Jobs</span>
                        {server.checks.pending_jobs.count !== null && server.checks.pending_jobs.count !== undefined && (
                          <span className="text-xs text-muted-foreground">
                            ({server.checks.pending_jobs.count})
                          </span>
                        )}
                      </div>
                      {/* Show actual iDRAC jobs if there are any */}
                      {server.checks.pending_jobs.jobs && server.checks.pending_jobs.jobs.length > 0 && (
                        <div className="ml-6 space-y-2 border-l-2 border-muted pl-3">
                          {server.checks.pending_jobs.jobs.map((job) => (
                            <div key={job.id} className="text-xs space-y-1 p-2 bg-muted/50 rounded">
                              <div className="flex items-center justify-between">
                                <code className="font-mono text-primary">{job.id}</code>
                                <Badge 
                                  variant={job.job_state === 'Running' ? 'default' : 'secondary'}
                                  className="text-[10px] h-5"
                                >
                                  {job.job_state}
                                </Badge>
                              </div>
                              <div className="text-muted-foreground font-medium">{job.name}</div>
                              {job.job_state === 'Running' && job.percent_complete !== undefined && (
                                <div className="flex items-center gap-2">
                                  <Progress value={job.percent_complete} className="h-1.5 flex-1" />
                                  <span className="text-[10px]">{job.percent_complete}%</span>
                                </div>
                              )}
                              {job.message && (
                                <div className="text-[10px] text-muted-foreground truncate">{job.message}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckIcon passed={server.checks.power_state.passed} />
                      <Activity className="h-3 w-3" />
                      <span>Power State</span>
                      {server.checks.power_state.state && (
                        <span className="text-xs text-muted-foreground">
                          ({server.checks.power_state.state})
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckIcon passed={server.checks.system_health.passed} />
                      <HardDrive className="h-3 w-3" />
                      <span>System Health</span>
                      {server.checks.system_health.overall && (
                        <span className="text-xs text-muted-foreground">
                          ({server.checks.system_health.overall})
                        </span>
                      )}
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
