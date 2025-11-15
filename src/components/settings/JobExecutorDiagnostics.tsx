import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Loader2, AlertCircle, ChevronDown, ChevronUp, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { testJobExecutorConnectivity, testCredentialAccess, testIdracReachability } from "@/lib/diagnostics";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface DiagnosticTest {
  id: string;
  name: string;
  description: string;
  status: 'idle' | 'running' | 'success' | 'failed' | 'skipped';
  duration?: number;
  error?: string;
  details?: any;
}

export function JobExecutorDiagnostics() {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [tests, setTests] = useState<DiagnosticTest[]>([
    {
      id: 'executor-ping',
      name: 'Job Executor Connectivity',
      description: 'Verify Job Executor is running and processing jobs',
      status: 'idle'
    },
    {
      id: 'credential-fetch',
      name: 'Credential Set Access',
      description: 'Verify Job Executor can fetch credential sets',
      status: 'idle'
    },
    {
      id: 'idrac-reachability',
      name: 'iDRAC Network Connectivity',
      description: 'Test connectivity to actual iDRAC devices',
      status: 'idle'
    }
  ]);
  const [expandedTests, setExpandedTests] = useState<Set<string>>(new Set());

  const updateTest = (id: string, updates: Partial<DiagnosticTest>) => {
    setTests(prev => prev.map(test => 
      test.id === id ? { ...test, ...updates } : test
    ));
  };

  const toggleExpanded = (testId: string) => {
    setExpandedTests(prev => {
      const next = new Set(prev);
      if (next.has(testId)) {
        next.delete(testId);
      } else {
        next.add(testId);
      }
      return next;
    });
  };

  const runAllTests = async () => {
    setRunning(true);
    
    // Reset all tests
    setTests(prev => prev.map(test => ({ ...test, status: 'idle', duration: undefined, error: undefined, details: undefined })));

    try {
      // Test 1: Job Executor Connectivity
      updateTest('executor-ping', { status: 'running' });
      const startTime1 = Date.now();
      
      const executorResult = await testJobExecutorConnectivity();
      const duration1 = Date.now() - startTime1;
      
      if (executorResult.online) {
        updateTest('executor-ping', { 
          status: 'success', 
          duration: duration1,
          details: { responseTime: executorResult.responseTime }
        });
      } else {
        updateTest('executor-ping', { 
          status: 'failed', 
          duration: duration1,
          error: executorResult.error
        });
        
        // Skip remaining tests if executor is offline
        updateTest('credential-fetch', { status: 'skipped' });
        updateTest('idrac-reachability', { status: 'skipped' });
        
        toast({
          title: "Job Executor Offline",
          description: "Start the Job Executor to continue testing",
          variant: "destructive"
        });
        
        setRunning(false);
        return;
      }

      // Test 2: Credential Access
      updateTest('credential-fetch', { status: 'running' });
      const startTime2 = Date.now();
      
      const credentialResult = await testCredentialAccess();
      const duration2 = Date.now() - startTime2;
      
      if (credentialResult.success) {
        updateTest('credential-fetch', { 
          status: 'success', 
          duration: duration2,
          details: { credentialCount: credentialResult.credentialCount }
        });
      } else {
        updateTest('credential-fetch', { 
          status: 'failed', 
          duration: duration2,
          error: credentialResult.error
        });
      }

      // Test 3: iDRAC Reachability (only if credentials exist)
      if (credentialResult.credentialCount > 0) {
        updateTest('idrac-reachability', { status: 'running' });
        const startTime3 = Date.now();
        
        const idracResult = await testIdracReachability();
        const duration3 = Date.now() - startTime3;
        
        const hasFailures = idracResult.unreachable > 0;
        updateTest('idrac-reachability', { 
          status: hasFailures ? 'failed' : 'success',
          duration: duration3,
          details: idracResult
        });
      } else {
        updateTest('idrac-reachability', { 
          status: 'skipped',
          error: 'No servers with credentials configured'
        });
      }

      toast({
        title: "Diagnostics Complete",
        description: "All tests finished successfully"
      });
    } catch (error: any) {
      toast({
        title: "Diagnostics Failed",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setRunning(false);
    }
  };

  const exportReport = () => {
    const report = {
      timestamp: new Date().toISOString(),
      tests: tests.map(test => ({
        name: test.name,
        status: test.status,
        duration: test.duration,
        error: test.error,
        details: test.details
      }))
    };
    
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `job-executor-diagnostics-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast({
      title: "Report Exported",
      description: "Diagnostics report downloaded"
    });
  };

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: "Text copied to clipboard"
    });
  };

  const getStatusIcon = (status: DiagnosticTest['status']) => {
    switch (status) {
      case 'running':
        return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
      case 'success':
        return <CheckCircle2 className="h-5 w-5 text-success" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-destructive" />;
      case 'skipped':
        return <AlertCircle className="h-5 w-5 text-muted-foreground" />;
      default:
        return <div className="h-5 w-5 rounded-full border-2 border-muted" />;
    }
  };

  const getStatusBadge = (status: DiagnosticTest['status']) => {
    switch (status) {
      case 'running':
        return <Badge variant="secondary">Running</Badge>;
      case 'success':
        return <Badge className="bg-success/10 text-success hover:bg-success/20">Passed</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      case 'skipped':
        return <Badge variant="outline">Skipped</Badge>;
      default:
        return <Badge variant="outline">Not Run</Badge>;
    }
  };

  const overallStatus = tests.every(t => t.status === 'success') ? 'online' :
                        tests.some(t => t.status === 'running') ? 'checking' :
                        tests.some(t => t.status === 'failed') ? 'offline' : 'unknown';

  return (
    <div className="space-y-4">
      {/* Status Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${
            overallStatus === 'online' ? 'bg-success' :
            overallStatus === 'checking' ? 'bg-primary animate-pulse' :
            overallStatus === 'offline' ? 'bg-destructive' :
            'bg-muted'
          }`} />
          <span className="font-medium">
            {overallStatus === 'online' ? 'Job Executor Online' :
             overallStatus === 'checking' ? 'Running Diagnostics...' :
             overallStatus === 'offline' ? 'Issues Detected' :
             'Status Unknown'}
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={runAllTests}
            disabled={running}
            size="sm"
          >
            {running ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Running Tests...
              </>
            ) : (
              'Run All Tests'
            )}
          </Button>
          {tests.some(t => t.status !== 'idle') && (
            <Button
              variant="outline"
              onClick={exportReport}
              size="sm"
            >
              Export Report
            </Button>
          )}
        </div>
      </div>

      {/* Test Results */}
      <div className="space-y-3">
        {tests.map(test => (
          <div
            key={test.id}
            className="border rounded-lg bg-card"
          >
            <div className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 flex-1">
                  {getStatusIcon(test.status)}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">{test.name}</span>
                      {getStatusBadge(test.status)}
                      {test.duration && (
                        <span className="text-xs text-muted-foreground">
                          {(test.duration / 1000).toFixed(1)}s
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{test.description}</p>
                    
                    {/* Error Message */}
                    {test.error && (
                      <Alert variant="destructive" className="mt-3">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          {test.error}
                          {test.id === 'executor-ping' && (
                            <>
                              <br /><br />
                              <strong>Start the Job Executor:</strong>
                              <div className="mt-2 space-y-2">
                                <div className="flex items-center gap-2">
                                  <code className="text-xs bg-background px-2 py-1 rounded flex-1">
                                    DSM_URL=http://127.0.0.1:54321 SERVICE_ROLE_KEY=your-key python job-executor.py
                                  </code>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => copyToClipboard('DSM_URL=http://127.0.0.1:54321 SERVICE_ROLE_KEY=your-key python job-executor.py')}
                                  >
                                    <Copy className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                            </>
                          )}
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                </div>
                
                {/* Expand Details Button */}
                {test.details && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleExpanded(test.id)}
                  >
                    {expandedTests.has(test.id) ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>

              {/* Expanded Details */}
              {test.details && expandedTests.has(test.id) && (
                <div className="mt-4 pt-4 border-t space-y-2">
                  {test.id === 'executor-ping' && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Response Time: </span>
                      <span className="font-mono">{test.details.responseTime}ms</span>
                    </div>
                  )}
                  
                  {test.id === 'credential-fetch' && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Credential Sets Available: </span>
                      <span className="font-mono">{test.details.credentialCount}</span>
                    </div>
                  )}
                  
                  {test.id === 'idrac-reachability' && test.details.results && (
                    <div className="space-y-2">
                      <div className="text-sm font-medium">
                        Server Test Results ({test.details.reachable}/{test.details.total} reachable)
                      </div>
                      <div className="space-y-1">
                        {test.details.results.map((result: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between text-sm p-2 bg-muted/50 rounded">
                            <div className="flex items-center gap-2">
                              {result.status === 'success' ? (
                                <CheckCircle2 className="h-4 w-4 text-success" />
                              ) : (
                                <XCircle className="h-4 w-4 text-destructive" />
                              )}
                              <span className="font-mono">{result.ip_address}</span>
                              {result.hostname && (
                                <span className="text-muted-foreground">({result.hostname})</span>
                              )}
                            </div>
                            <div className="text-muted-foreground">
                              {result.responseTime ? `${result.responseTime}ms` : result.error}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Help Text */}
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <strong>Troubleshooting Tips:</strong>
          <ul className="list-disc ml-4 mt-2 space-y-1 text-sm">
            <li>Ensure Job Executor is running with proper environment variables</li>
            <li>Verify network connectivity between Job Executor and iDRAC devices</li>
            <li>Check that credential sets are configured correctly</li>
            <li>Review Activity Monitor for detailed error logs</li>
          </ul>
        </AlertDescription>
      </Alert>
    </div>
  );
}
