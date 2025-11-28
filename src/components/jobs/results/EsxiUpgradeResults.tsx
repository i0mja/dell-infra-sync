import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Server, CheckCircle2, XCircle, Clock, Terminal, AlertTriangle } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface EsxiUpgradeResultsProps {
  details: any;
  jobType: string;
}

export const EsxiUpgradeResults = ({ details, jobType }: EsxiUpgradeResultsProps) => {
  const [expandedHosts, setExpandedHosts] = useState<Set<string>>(new Set());

  const toggleHost = (hostId: string) => {
    const newExpanded = new Set(expandedHosts);
    if (newExpanded.has(hostId)) {
      newExpanded.delete(hostId);
    } else {
      newExpanded.add(hostId);
    }
    setExpandedHosts(newExpanded);
  };

  const hosts = details?.hosts || [];
  const esxiPhase = details?.esxi_phase;
  const firmwarePhase = details?.firmware_phase;
  const isCombinedWorkflow = jobType === 'esxi_then_firmware' || jobType === 'firmware_then_esxi';

  const successCount = hosts.filter((h: any) => h.status === 'success').length;
  const failureCount = hosts.filter((h: any) => h.status === 'failed').length;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Server className="h-4 w-4" />
              Total Hosts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{hosts.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Successful
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">{successCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <XCircle className="h-4 w-4" />
              Failed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{failureCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Workflow Type
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm font-medium">
              {jobType === 'esxi_upgrade' && 'ESXi Only'}
              {jobType === 'esxi_then_firmware' && 'ESXi → Firmware'}
              {jobType === 'firmware_then_esxi' && 'Firmware → ESXi'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Combined Workflow Phases */}
      {isCombinedWorkflow && (
        <div className="grid md:grid-cols-2 gap-4">
          {esxiPhase && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  ESXi Upgrade Phase
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Status:</span>
                  <Badge variant={esxiPhase.status === 'completed' ? 'default' : 'destructive'}>
                    {esxiPhase.status}
                  </Badge>
                </div>
                {esxiPhase.duration && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Duration:</span>
                    <span>{esxiPhase.duration}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {firmwarePhase && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  Firmware Update Phase
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Status:</span>
                  <Badge variant={firmwarePhase.status === 'completed' ? 'default' : 'destructive'}>
                    {firmwarePhase.status}
                  </Badge>
                </div>
                {firmwarePhase.duration && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Duration:</span>
                    <span>{firmwarePhase.duration}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Host Results */}
      <Card>
        <CardHeader>
          <CardTitle>Host Upgrade Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {hosts.map((host: any) => (
            <Collapsible key={host.id || host.name}>
              <Card className={host.status === 'failed' ? 'border-destructive' : ''}>
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${
                          host.status === 'success' 
                            ? 'bg-success/10' 
                            : 'bg-destructive/10'
                        }`}>
                          {host.status === 'success' ? (
                            <CheckCircle2 className="h-5 w-5 text-success" />
                          ) : (
                            <XCircle className="h-5 w-5 text-destructive" />
                          )}
                        </div>
                        <div>
                          <div className="font-medium">{host.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {host.version_before && host.version_after && (
                              <span>{host.version_before} → {host.version_after}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm">
                        {expandedHosts.has(host.id || host.name) ? 'Hide' : 'Show'} Details
                      </Button>
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                
                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-4">
                    {/* Timeline */}
                    {host.steps && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium">Upgrade Steps</h4>
                        <div className="space-y-1">
                          {host.steps.map((step: any, idx: number) => (
                            <div key={idx} className="flex items-center gap-2 text-sm">
                              {step.completed ? (
                                <CheckCircle2 className="h-4 w-4 text-success" />
                              ) : step.error ? (
                                <XCircle className="h-4 w-4 text-destructive" />
                              ) : (
                                <Clock className="h-4 w-4 text-muted-foreground" />
                              )}
                              <span className={step.error ? 'text-destructive' : ''}>
                                {step.name}
                              </span>
                              {step.duration && (
                                <span className="text-muted-foreground">({step.duration})</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Error Details */}
                    {host.error && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium flex items-center gap-2 text-destructive">
                          <AlertTriangle className="h-4 w-4" />
                          Error Details
                        </h4>
                        <div className="bg-destructive/10 p-3 rounded-lg">
                          <pre className="text-xs text-destructive whitespace-pre-wrap">
                            {host.error}
                          </pre>
                        </div>
                      </div>
                    )}

                    {/* SSH Output */}
                    {host.ssh_output && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium flex items-center gap-2">
                          <Terminal className="h-4 w-4" />
                          SSH Command Output
                        </h4>
                        <div className="bg-muted p-3 rounded-lg">
                          <pre className="text-xs whitespace-pre-wrap font-mono">
                            {host.ssh_output}
                          </pre>
                        </div>
                      </div>
                    )}

                    {/* Additional Metrics */}
                    <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                      {host.reconnect_time && (
                        <div>
                          <div className="text-xs text-muted-foreground">Reconnect Time</div>
                          <div className="text-sm font-medium">{host.reconnect_time}</div>
                        </div>
                      )}
                      {host.total_duration && (
                        <div>
                          <div className="text-xs text-muted-foreground">Total Duration</div>
                          <div className="text-sm font-medium">{host.total_duration}</div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};
