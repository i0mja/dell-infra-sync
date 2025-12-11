import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, AlertTriangle, Server, Cpu, HardDrive, Terminal, Shield, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface PreflightCheck {
  check: string;
  ok: boolean;
  value: string;
}

interface ValidationResults {
  vm_name?: string;
  vm_ip?: string;
  hostname?: string;
  os_family?: string;
  os_supported?: boolean;
  kernel_version?: string;
  memory_gb?: number;
  zfs_already_installed?: boolean;
  preflight_checks?: PreflightCheck[];
  all_checks_passed?: boolean;
  ready_for_preparation?: boolean;
}

interface ValidationPreflightResultsProps {
  details: Record<string, any>;
  status: string;
}

export const ValidationPreflightResults = ({ details, status }: ValidationPreflightResultsProps) => {
  const results = details?.validation_results as ValidationResults | undefined;
  const preflightChecks = results?.preflight_checks || details?.preflight_checks || [];
  
  if (!results && preflightChecks.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-muted-foreground">
          No validation results available yet.
        </CardContent>
      </Card>
    );
  }

  const getCheckIcon = (check: PreflightCheck) => {
    if (check.ok) {
      return <CheckCircle className="h-4 w-4 text-success" />;
    }
    // Warnings vs errors
    if (check.check === 'zfs_installed' && check.value?.includes('already installed')) {
      return <Info className="h-4 w-4 text-primary" />;
    }
    return <XCircle className="h-4 w-4 text-destructive" />;
  };

  const formatCheckName = (name: string) => {
    return name
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  };

  return (
    <div className="space-y-4">
      {/* Summary Card */}
      {results && (
        <Card className={cn(
          "border-l-4",
          results.ready_for_preparation 
            ? "border-l-success" 
            : status === 'failed' 
            ? "border-l-destructive" 
            : "border-l-warning"
        )}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Server className="h-5 w-5" />
                Validation Summary
              </CardTitle>
              <Badge variant={results.ready_for_preparation ? "secondary" : "outline"}>
                {results.ready_for_preparation ? "Ready" : "Issues Found"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* VM Info Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              {results.vm_name && (
                <div>
                  <span className="text-muted-foreground">VM Name</span>
                  <p className="font-medium">{results.vm_name}</p>
                </div>
              )}
              {results.vm_ip && (
                <div>
                  <span className="text-muted-foreground">IP Address</span>
                  <p className="font-mono">{results.vm_ip}</p>
                </div>
              )}
              {results.hostname && (
                <div>
                  <span className="text-muted-foreground">Hostname</span>
                  <p className="font-mono">{results.hostname}</p>
                </div>
              )}
              {results.os_family && (
                <div className="flex items-start gap-2">
                  <div>
                    <span className="text-muted-foreground">OS Family</span>
                    <p className="font-medium capitalize">{results.os_family}</p>
                  </div>
                  {results.os_supported ? (
                    <CheckCircle className="h-4 w-4 text-success mt-5" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive mt-5" />
                  )}
                </div>
              )}
              {results.kernel_version && (
                <div>
                  <span className="text-muted-foreground">Kernel</span>
                  <p className="font-mono text-xs">{results.kernel_version}</p>
                </div>
              )}
              {results.memory_gb !== undefined && (
                <div>
                  <span className="text-muted-foreground">Memory</span>
                  <p className="font-medium">{results.memory_gb} GB</p>
                </div>
              )}
            </div>

            {/* ZFS Status */}
            {results.zfs_already_installed !== undefined && (
              <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
                <Shield className="h-4 w-4" />
                <span className="text-sm">
                  ZFS: {results.zfs_already_installed ? (
                    <span className="text-primary font-medium">Already installed</span>
                  ) : (
                    <span className="text-muted-foreground">Not installed (will be installed during preparation)</span>
                  )}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Preflight Checks */}
      {preflightChecks.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Terminal className="h-5 w-5" />
              Pre-flight Checks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {preflightChecks.map((check: PreflightCheck, idx: number) => (
                <div 
                  key={idx}
                  className={cn(
                    "flex items-start gap-3 p-2 rounded",
                    check.ok ? "bg-success/5" : "bg-destructive/5"
                  )}
                >
                  {getCheckIcon(check)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{formatCheckName(check.check)}</p>
                    <p className="text-xs text-muted-foreground break-all">{check.value}</p>
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
