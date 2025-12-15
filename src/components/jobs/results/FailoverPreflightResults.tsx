import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Shield, 
  Server, 
  Database, 
  Network, 
  Clock,
  Zap,
  HardDrive,
  Activity,
  Layers,
  Settings,
  Wrench,
  Wand2,
  Key
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Remediation } from "@/hooks/usePreflightRemediation";

interface PreflightCheck {
  name: string;
  passed: boolean;
  message: string;
  can_override?: boolean;
  is_warning?: boolean;
  details?: string[];
  remediation?: Remediation;
}

interface PreflightResult {
  ready: boolean;
  can_proceed: boolean;
  can_force: boolean;
  checks: Record<string, PreflightCheck>;
  blockers: PreflightCheck[];
  warnings: PreflightCheck[];
  checked_at: string;
  protection_group_id: string;
  group_name: string;
  vm_count: number;
}

interface StepResult {
  step: string;
  status: 'success' | 'failed' | 'warning';
  passed: boolean;
  message: string;
  timestamp: string;
  remediation?: Remediation;
}

interface FailoverPreflightResultsProps {
  details: {
    result?: PreflightResult;
    step_results?: StepResult[];
    console_log?: string[];
    error?: string;
  };
  onApplyFix?: (remediation: Remediation) => void;
  onApplyAllFixes?: () => void;
  isApplyingFix?: boolean;
}

const getCheckIcon = (checkKey: string) => {
  const icons: Record<string, React.ReactNode> = {
    'dr_shell_vms_exist': <Server className="h-4 w-4" />,
    'replication_current': <Clock className="h-4 w-4" />,
    'site_b_zfs_healthy': <Database className="h-4 w-4" />,
    'site_b_ssh_connectivity': <Key className="h-4 w-4" />,
    'site_b_vcenter_connected': <Activity className="h-4 w-4" />,
    'nfs_datastore_mounted': <HardDrive className="h-4 w-4" />,
    'no_conflicting_jobs': <Layers className="h-4 w-4" />,
    'snapshots_consistent': <Shield className="h-4 w-4" />,
    'network_mapping_valid': <Network className="h-4 w-4" />,
    'group_not_paused': <Zap className="h-4 w-4" />,
    'resources_available': <Settings className="h-4 w-4" />,
  };
  return icons[checkKey] || <Shield className="h-4 w-4" />;
};

export const FailoverPreflightResults = ({ 
  details, 
  onApplyFix, 
  onApplyAllFixes,
  isApplyingFix 
}: FailoverPreflightResultsProps) => {
  const result = details?.result;
  const stepResults = details?.step_results;

  if (!result && !stepResults) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-sm">No pre-flight check results available.</p>
        </CardContent>
      </Card>
    );
  }

  // Use result if available, otherwise build from step_results
  const checks = result?.checks || {};
  const blockers = result?.blockers || [];
  const warnings = result?.warnings || [];
  const isReady = result?.ready ?? (blockers.length === 0);

  // Count auto-fixable issues
  const autoFixableBlockers = blockers.filter(b => b.remediation?.can_auto_fix);
  const autoFixableWarnings = warnings.filter(w => w.remediation?.can_auto_fix);
  const totalAutoFixable = autoFixableBlockers.length + autoFixableWarnings.length;

  return (
    <div className="space-y-4">
      {/* Overall Status Card */}
      <Card className={`border-2 ${isReady ? 'border-success/50 bg-success/5' : 'border-destructive/50 bg-destructive/5'}`}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-lg">
            <div className="flex items-center gap-2">
              {isReady ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-success" />
                  <span className="text-success">Ready for Failover</span>
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-destructive" />
                  <span className="text-destructive">Not Ready for Failover</span>
                </>
              )}
            </div>
            {totalAutoFixable > 0 && onApplyAllFixes && (
              <Button 
                size="sm" 
                onClick={onApplyAllFixes}
                disabled={isApplyingFix}
              >
                <Wand2 className="h-4 w-4 mr-1" />
                Auto-Fix {totalAutoFixable} Issues
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            {result?.group_name && (
              <span>Group: <strong className="text-foreground">{result.group_name}</strong></span>
            )}
            {result?.vm_count !== undefined && (
              <span>VMs: <strong className="text-foreground">{result.vm_count}</strong></span>
            )}
            {result?.checked_at && (
              <span>Checked: <strong className="text-foreground">{new Date(result.checked_at).toLocaleString()}</strong></span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Individual Checks Grid */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Pre-Flight Checks</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {Object.entries(checks).map(([key, check]) => (
              <div 
                key={key} 
                className={`flex items-center gap-3 p-3 rounded-lg border ${
                  check.passed 
                    ? 'bg-success/5 border-success/20' 
                    : check.is_warning 
                    ? 'bg-warning/5 border-warning/20' 
                    : 'bg-destructive/5 border-destructive/20'
                }`}
              >
                <div className={`${
                  check.passed 
                    ? 'text-success' 
                    : check.is_warning 
                    ? 'text-warning' 
                    : 'text-destructive'
                }`}>
                  {getCheckIcon(key)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{check.name}</span>
                    {check.passed ? (
                      <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
                    ) : check.is_warning ? (
                      <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{check.message}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {check.can_override && !check.passed && (
                    <Badge variant="outline" className="text-xs">Override</Badge>
                  )}
                  {!check.passed && check.remediation && onApplyFix && (
                    <Button 
                      size="sm" 
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => onApplyFix(check.remediation!)}
                      disabled={isApplyingFix}
                    >
                      <Wrench className="h-3 w-3 mr-1" />
                      Fix
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Blockers Alert */}
      {blockers.length > 0 && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Blockers ({blockers.length})</AlertTitle>
          <AlertDescription>
            <ScrollArea className="max-h-[150px]">
              <ul className="space-y-2 mt-2">
                {blockers.map((blocker, idx) => (
                  <li key={idx} className="flex items-start justify-between gap-2 text-sm">
                    <div className="flex items-start gap-2">
                      <span className="text-destructive mt-0.5">•</span>
                      <div>
                        <strong>{blocker.name}:</strong> {blocker.message}
                        {blocker.can_override && (
                          <Badge variant="outline" className="ml-2 text-xs">Can override</Badge>
                        )}
                      </div>
                    </div>
                    {blocker.remediation && onApplyFix && (
                      <Button 
                        size="sm" 
                        variant="outline"
                        className="h-6 text-xs shrink-0"
                        onClick={() => onApplyFix(blocker.remediation!)}
                        disabled={isApplyingFix}
                      >
                        <Wrench className="h-3 w-3 mr-1" />
                        {blocker.remediation.can_auto_fix ? 'Fix' : 'Fix...'}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </AlertDescription>
        </Alert>
      )}

      {/* Warnings Alert */}
      {warnings.length > 0 && (
        <Alert className="border-warning/50 bg-warning/5">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <AlertTitle className="text-warning">Warnings ({warnings.length})</AlertTitle>
          <AlertDescription>
            <ScrollArea className="max-h-[150px]">
              <ul className="space-y-2 mt-2">
                {warnings.map((warning, idx) => (
                  <li key={idx} className="flex items-start justify-between gap-2 text-sm">
                    <div className="flex items-start gap-2">
                      <span className="text-warning mt-0.5">•</span>
                      <div>
                        <strong>{warning.name}:</strong> {warning.message}
                      </div>
                    </div>
                    {warning.remediation && onApplyFix && (
                      <Button 
                        size="sm" 
                        variant="outline"
                        className="h-6 text-xs shrink-0"
                        onClick={() => onApplyFix(warning.remediation!)}
                        disabled={isApplyingFix}
                      >
                        <Wrench className="h-3 w-3 mr-1" />
                        {warning.remediation.can_auto_fix ? 'Fix' : 'Fix...'}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </AlertDescription>
        </Alert>
      )}

      {/* Step Results Timeline */}
      {stepResults && stepResults.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Check Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stepResults.map((step, idx) => (
                <div 
                  key={idx} 
                  className="flex items-center gap-3 p-2 rounded border bg-muted/30"
                >
                  {step.status === 'success' ? (
                    <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
                  ) : step.status === 'warning' ? (
                    <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-sm">{step.step}</span>
                    <span className="text-muted-foreground text-xs ml-2">{step.message}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {step.status !== 'success' && step.remediation && onApplyFix && (
                      <Button 
                        size="sm" 
                        variant="ghost"
                        className="h-6 text-xs"
                        onClick={() => onApplyFix(step.remediation!)}
                        disabled={isApplyingFix}
                      >
                        <Wrench className="h-3 w-3" />
                      </Button>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {new Date(step.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
