import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, AlertTriangle, Clock, Server, Lock, Network, Shield, Activity } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

interface ConnectivityTestResult {
  overall_status: 'passed' | 'partial' | 'failed';
  vcenter_host: string;
  vcenter_port: number;
  timestamp: string;
  message: string;
  critical_failure?: string;
  tests: {
    dns?: {
      success: boolean;
      message: string;
      resolved_ips?: string[];
      response_time_ms?: number;
      error?: string;
    };
    port?: {
      success: boolean;
      message: string;
      response_time_ms?: number;
      error?: string;
      error_code?: number;
    };
    ssl?: {
      success: boolean;
      message: string;
      days_until_expiry?: number;
      expires?: string;
      error?: string;
      details?: string;
    };
    auth?: {
      success: boolean;
      message: string;
      vcenter_version?: string;
      vcenter_build?: string;
      api_version?: string;
      response_time_ms?: number;
      error?: string;
    };
    api?: {
      success: boolean;
      message: string;
      hosts_found?: number;
      clusters_found?: number;
      error?: string;
    };
  };
}

interface VCenterConnectivityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  results: ConnectivityTestResult | null;
}

const TestResultIcon = ({ success }: { success: boolean }) => {
  if (success) {
    return <CheckCircle2 className="h-5 w-5 text-green-500" />;
  }
  return <XCircle className="h-5 w-5 text-destructive" />;
};

const TestResultCard = ({ 
  icon: Icon, 
  title, 
  test, 
  details 
}: { 
  icon: any; 
  title: string; 
  test?: { success: boolean; message: string; [key: string]: any }; 
  details?: string[];
}) => {
  if (!test) return null;

  return (
    <Card className={test.success ? "border-green-200 dark:border-green-900" : "border-destructive/50"}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg ${test.success ? 'bg-green-100 dark:bg-green-950' : 'bg-destructive/10'}`}>
            <Icon className={`h-5 w-5 ${test.success ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`} />
          </div>
          <div className="flex-1 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="font-medium text-sm">{title}</h4>
                <p className={`text-sm ${test.success ? 'text-muted-foreground' : 'text-destructive'}`}>
                  {test.message}
                </p>
              </div>
              <TestResultIcon success={test.success} />
            </div>
            {details && details.length > 0 && (
              <div className="space-y-1 text-xs text-muted-foreground">
                {details.map((detail, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <div className="h-1 w-1 rounded-full bg-muted-foreground/50" />
                    <span>{detail}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export function VCenterConnectivityDialog({ open, onOpenChange, results }: VCenterConnectivityDialogProps) {
  if (!results) return null;

  const getStatusBadge = () => {
    switch (results.overall_status) {
      case 'passed':
        return <Badge className="bg-green-500 hover:bg-green-600">All Tests Passed</Badge>;
      case 'partial':
        return <Badge variant="outline" className="border-yellow-500 text-yellow-600">Partial Success</Badge>;
      case 'failed':
        return <Badge variant="destructive">Tests Failed</Badge>;
    }
  };

  const dnsDetails = results.tests.dns ? [
    results.tests.dns.resolved_ips ? `Resolved to: ${results.tests.dns.resolved_ips[0]}` : null,
    results.tests.dns.response_time_ms ? `Response time: ${results.tests.dns.response_time_ms}ms` : null,
  ].filter(Boolean) as string[] : [];

  const portDetails = results.tests.port ? [
    results.tests.port.response_time_ms ? `Connection time: ${results.tests.port.response_time_ms}ms` : null,
  ].filter(Boolean) as string[] : [];

  const sslDetails = results.tests.ssl ? [
    results.tests.ssl.days_until_expiry !== undefined 
      ? results.tests.ssl.days_until_expiry < 30 
        ? `⚠️ Certificate expires in ${results.tests.ssl.days_until_expiry} days` 
        : `Certificate expires in ${results.tests.ssl.days_until_expiry} days`
      : null,
    results.tests.ssl.expires ? `Expiry: ${results.tests.ssl.expires}` : null,
  ].filter(Boolean) as string[] : [];

  const authDetails = results.tests.auth ? [
    results.tests.auth.vcenter_version ? `Version: ${results.tests.auth.vcenter_version}` : null,
    results.tests.auth.api_version ? `API Version: ${results.tests.auth.api_version}` : null,
    results.tests.auth.response_time_ms ? `Auth time: ${results.tests.auth.response_time_ms}ms` : null,
  ].filter(Boolean) as string[] : [];

  const apiDetails = results.tests.api ? [
    results.tests.api.clusters_found !== undefined ? `${results.tests.api.clusters_found} cluster(s)` : null,
    results.tests.api.hosts_found !== undefined ? `${results.tests.api.hosts_found} host(s)` : null,
  ].filter(Boolean) as string[] : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>vCenter Connectivity Test Results</DialogTitle>
            {getStatusBadge()}
          </div>
          <DialogDescription>
            Target: {results.vcenter_host}:{results.vcenter_port}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {results.critical_failure && (
            <Card className="border-destructive bg-destructive/5">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
                  <div>
                    <h4 className="font-medium text-sm text-destructive">Critical Failure</h4>
                    <p className="text-sm text-muted-foreground">{results.critical_failure}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Connectivity Tests
            </h3>
            
            <TestResultCard
              icon={Network}
              title="DNS Resolution"
              test={results.tests.dns}
              details={dnsDetails}
            />

            <TestResultCard
              icon={Server}
              title="Port Accessibility"
              test={results.tests.port}
              details={portDetails}
            />

            <TestResultCard
              icon={Shield}
              title="SSL Certificate"
              test={results.tests.ssl}
              details={sslDetails}
            />

            <TestResultCard
              icon={Lock}
              title="Authentication"
              test={results.tests.auth}
              details={authDetails}
            />

            <TestResultCard
              icon={Activity}
              title="API Functionality"
              test={results.tests.api}
              details={apiDetails}
            />
          </div>

          <Separator />

          <div className="rounded-lg bg-muted p-4">
            <p className="text-sm font-medium">{results.message}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Test completed at {new Date(results.timestamp).toLocaleString()}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
