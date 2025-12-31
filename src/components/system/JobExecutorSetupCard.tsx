import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SecretRevealCard } from "./SecretRevealCard";
import { copyToClipboard } from "@/lib/clipboard";
import { 
  Server, CheckCircle, XCircle, Loader2, ChevronDown, 
  ExternalLink, AlertCircle, Copy, Terminal
} from "lucide-react";
import { 
  setJobExecutorUrl, getJobExecutorUrl, testJobExecutorConnection, 
  initializeJobExecutorUrl 
} from "@/lib/job-executor-api";

interface StepStatus {
  url: 'pending' | 'complete' | 'error';
  serviceKey: 'pending' | 'complete';
  hmac: 'pending' | 'complete' | 'error';
  connection: 'pending' | 'complete' | 'error';
}

export function JobExecutorSetupCard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [sslOpen, setSslOpen] = useState(false);
  
  // URL State
  const [executorUrl, setExecutorUrlState] = useState(getJobExecutorUrl());
  const [urlTesting, setUrlTesting] = useState(false);
  const [urlStatus, setUrlStatus] = useState<'unknown' | 'connected' | 'failed'>('unknown');
  const [activitySettingsId, setActivitySettingsId] = useState<string | null>(null);
  
  // Service Key State
  const [serviceKey, setServiceKey] = useState<string | null>(null);
  const [serviceKeyLoading, setServiceKeyLoading] = useState(false);
  const [serviceKeyRevealed, setServiceKeyRevealed] = useState(false);
  
  // HMAC State
  const [hmacConfigured, setHmacConfigured] = useState<boolean | null>(null);
  const [hmacSecret, setHmacSecret] = useState<string | null>(null);
  const [hmacRevealed, setHmacRevealed] = useState(false);
  const [hmacLoading, setHmacLoading] = useState(false);
  const [hmacTestResult, setHmacTestResult] = useState<any>(null);
  const [hmacTesting, setHmacTesting] = useState(false);

  useEffect(() => {
    loadSettings();
    checkHmacStatus();
  }, []);

  const loadSettings = async () => {
    const { data } = await supabase
      .from('activity_settings')
      .select('id, job_executor_url')
      .maybeSingle();

    if (data) {
      setActivitySettingsId(data.id);
      if (data.job_executor_url) {
        setExecutorUrlState(data.job_executor_url);
        initializeJobExecutorUrl(data.job_executor_url);
      }
    }
  };

  const checkHmacStatus = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('set-executor-secret', {
        body: { action: 'check' }
      });
      if (error) throw error;
      setHmacConfigured(data.configured);
    } catch {
      setHmacConfigured(false);
    }
  };

  const handleTestConnection = async () => {
    setUrlTesting(true);
    setUrlStatus('unknown');
    
    const result = await testJobExecutorConnection(executorUrl);
    
    if (result.success) {
      setUrlStatus('connected');
      toast({ title: "Connected", description: "Job Executor is reachable" });
    } else {
      setUrlStatus('failed');
      toast({ 
        title: "Connection Failed", 
        description: result.message,
        variant: "destructive" 
      });
    }
    
    setUrlTesting(false);
  };

  const handleSaveUrl = async () => {
    setLoading(true);
    try {
      setJobExecutorUrl(executorUrl);
      
      if (activitySettingsId) {
        await supabase
          .from('activity_settings')
          .update({ job_executor_url: executorUrl })
          .eq('id', activitySettingsId);
      } else {
        const { data } = await supabase
          .from('activity_settings')
          .insert([{ job_executor_url: executorUrl }])
          .select()
          .single();
        if (data) setActivitySettingsId(data.id);
      }

      toast({ title: "Saved", description: "Job Executor URL saved" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleRevealServiceKey = async () => {
    setServiceKeyLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-service-key');
      if (error) throw error;
      setServiceKey(data.service_role_key);
      setServiceKeyRevealed(true);
    } catch (error: any) {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to retrieve service key",
        variant: "destructive" 
      });
    } finally {
      setServiceKeyLoading(false);
    }
  };

  const handleRevealHmac = async () => {
    setHmacLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('set-executor-secret', {
        body: { action: 'reveal' }
      });
      if (error) throw error;
      
      setHmacSecret(data.secret);
      setHmacRevealed(true);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to retrieve secret",
        variant: "destructive",
      });
    } finally {
      setHmacLoading(false);
    }
  };

  const handleGenerateHmac = async () => {
    setHmacLoading(true);
    setHmacSecret(null);
    setHmacRevealed(false);
    try {
      const { data, error } = await supabase.functions.invoke('set-executor-secret', {
        body: { action: 'generate' }
      });
      if (error) throw error;
      
      setHmacConfigured(true);
      setHmacSecret(data.secret);
      setHmacRevealed(true);
      toast({
        title: "Secret Generated",
        description: "Copy the secret to your Job Executor configuration",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to generate secret",
        variant: "destructive",
      });
    } finally {
      setHmacLoading(false);
    }
  };

  const handleTestHmac = async () => {
    setHmacTesting(true);
    setHmacTestResult(null);
    try {
      // Call update-job with ping action - this tests if HMAC is working
      const { data, error } = await supabase.functions.invoke('update-job', {
        body: { action: 'ping' }
      });
      
      setHmacTestResult(data || { error: error?.message });
      
      if (data?.success) {
        toast({
          title: "HMAC Test Passed",
          description: `Authenticated via ${data.auth_method}`,
        });
      } else {
        toast({
          title: "HMAC Test Info",
          description: data?.message || error?.message || "Check results below",
          variant: data?.secret_configured_in_edge ? "destructive" : "default",
        });
      }
    } catch (error: any) {
      setHmacTestResult({ error: error.message });
      toast({
        title: "Test Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setHmacTesting(false);
    }
  };

  const showSslWarning = executorUrl.startsWith('http://') && window.location.protocol === 'https:';

  return (
    <div className="space-y-4">
      {/* Step 1: URL Configuration */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="h-4 w-4" />
            Job Executor URL
          </CardTitle>
          <CardDescription>
            Connect to the Python backend service running on your server
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              type="url"
              value={executorUrl}
              onChange={(e) => setExecutorUrlState(e.target.value)}
              placeholder="http://localhost:8081"
              className="font-mono text-sm"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={handleTestConnection}
              disabled={urlTesting}
            >
              {urlTesting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : urlStatus === 'connected' ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : urlStatus === 'failed' ? (
                <XCircle className="h-4 w-4 text-destructive" />
              ) : (
                <Server className="h-4 w-4" />
              )}
            </Button>
          </div>
          
          <p className="text-xs text-muted-foreground">
            Use <code className="px-1 bg-muted rounded">http://localhost:8081</code> locally, 
            or your server's IP when accessing remotely.
          </p>

          {urlStatus === 'connected' && (
            <Alert className="border-green-500/50 bg-green-500/10 py-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <AlertDescription className="text-sm text-green-700 dark:text-green-400">
                Connected and responding
              </AlertDescription>
            </Alert>
          )}

          {urlStatus === 'failed' && (
            <Alert variant="destructive" className="py-2">
              <XCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                Cannot reach Job Executor. Ensure it's running and the URL is correct.
              </AlertDescription>
            </Alert>
          )}

          {/* SSL Warning & Instructions */}
          {showSslWarning && (
            <Collapsible open={sslOpen} onOpenChange={setSslOpen}>
              <Alert className="border-amber-500/50 bg-amber-500/10 py-2">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-sm text-amber-700 dark:text-amber-400">
                  <div className="flex items-center justify-between">
                    <span>HTTPS required for remote access</span>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-6 px-2">
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${sslOpen ? 'rotate-180' : ''}`} />
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                </AlertDescription>
              </Alert>
              <CollapsibleContent className="mt-2 p-3 border rounded-lg bg-muted/30 text-xs space-y-2">
                <p><strong>To enable HTTPS on the Job Executor:</strong></p>
                <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                  <li>Generate SSL certificate using the provided script</li>
                  <li>Set <code className="px-1 bg-muted rounded">API_SERVER_SSL_ENABLED=true</code></li>
                  <li>Restart the Job Executor service</li>
                </ol>
                {executorUrl.startsWith('https://') && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs mt-2"
                    onClick={() => window.open(`${executorUrl}/api/health`, '_blank')}
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Trust Certificate
                  </Button>
                )}
              </CollapsibleContent>
            </Collapsible>
          )}

          <Button onClick={handleSaveUrl} disabled={loading} size="sm">
            {loading ? "Saving..." : "Save URL"}
          </Button>
        </CardContent>
      </Card>

      {/* Step 2 & 3: Secrets */}
      <div className="grid gap-4 md:grid-cols-2">
        <SecretRevealCard
          title="Service Role Key"
          description="Required for executor to authenticate with the backend"
          envVarName="SERVICE_ROLE_KEY"
          secret={serviceKey}
          isRevealed={serviceKeyRevealed}
          isLoading={serviceKeyLoading}
          onReveal={handleRevealServiceKey}
          linuxInstructions={{
            filePath: "/opt/job-executor/.env",
            restartCommand: "sudo systemctl restart dell-job-executor"
          }}
          windowsInstructions={{
            command: 'nssm set DellServerManagerJobExecutor AppEnvironmentExtra "SERVICE_ROLE_KEY=${SECRET}" ...',
            restartCommand: "nssm restart DellServerManagerJobExecutor"
          }}
        />

        <SecretRevealCard
          title="Executor Shared Secret"
          description="HMAC authentication key for secure job updates"
          envVarName="EXECUTOR_SHARED_SECRET"
          secret={hmacSecret}
          isRevealed={hmacRevealed}
          isLoading={hmacLoading}
          isConfigured={hmacConfigured}
          showStatus={true}
          statusMessage={{
            configured: "Shared secret configured",
            notConfigured: "Not configured - job updates will fail"
          }}
          onReveal={handleRevealHmac}
          onGenerate={handleGenerateHmac}
          canRegenerate={true}
          linuxInstructions={{
            filePath: "/opt/job-executor/.env",
            restartCommand: "sudo systemctl restart dell-job-executor"
          }}
          windowsInstructions={{
            command: 'nssm set DellServerManagerJobExecutor AppEnvironmentExtra ... "EXECUTOR_SHARED_SECRET=${SECRET}"',
            restartCommand: "nssm restart DellServerManagerJobExecutor"
          }}
          extraContent={
            <div className="mt-3 pt-3 border-t space-y-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleTestHmac}
                disabled={hmacTesting}
                className="w-full"
              >
                {hmacTesting ? (
                  <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                ) : null}
                Test Connection
              </Button>
              {hmacTestResult && (
                <div className={`text-xs p-2 rounded font-mono ${
                  hmacTestResult.success 
                    ? 'bg-green-500/10 text-green-700 dark:text-green-400' 
                    : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                }`}>
                  <div><strong>Auth method:</strong> {hmacTestResult.auth_method || 'none'}</div>
                  <div><strong>Edge secret:</strong> {hmacTestResult.secret_configured_in_edge ? hmacTestResult.secret_prefix : 'NOT SET'}</div>
                  {hmacTestResult.received_sig_prefix && (
                    <div><strong>Received sig:</strong> {hmacTestResult.received_sig_prefix}</div>
                  )}
                  <div><strong>Result:</strong> {hmacTestResult.message || hmacTestResult.error || 'Unknown'}</div>
                </div>
              )}
            </div>
          }
        />
      </div>

      {/* Copy All Environment Variables */}
      <CopyAllEnvVarsCard
        supabaseUrl={import.meta.env.VITE_SUPABASE_URL || ''}
        serviceKey={serviceKey}
        executorSecret={hmacSecret}
        serviceKeyRevealed={serviceKeyRevealed}
        executorSecretRevealed={hmacRevealed}
      />
    </div>
  );
}

interface CopyAllEnvVarsCardProps {
  supabaseUrl: string;
  serviceKey: string | null;
  executorSecret: string | null;
  serviceKeyRevealed: boolean;
  executorSecretRevealed: boolean;
}

function CopyAllEnvVarsCard({
  supabaseUrl,
  serviceKey,
  executorSecret,
  serviceKeyRevealed,
  executorSecretRevealed,
}: CopyAllEnvVarsCardProps) {
  const { toast } = useToast();
  const bothRevealed = serviceKeyRevealed && executorSecretRevealed;
  
  const windowsCommand = `nssm set DellServerManagerJobExecutor AppEnvironmentExtra ^
  "DSM_URL=${supabaseUrl}" ^
  "SUPABASE_URL=${supabaseUrl}" ^
  "SERVICE_ROLE_KEY=${serviceKey || '<reveal above>'}" ^
  "EXECUTOR_SHARED_SECRET=${executorSecret || '<reveal above>'}"`;

  const linuxEnvFile = `[Service]
Environment="DSM_URL=${supabaseUrl}"
Environment="SUPABASE_URL=${supabaseUrl}"
Environment="SERVICE_ROLE_KEY=${serviceKey || '<reveal above>'}"
Environment="EXECUTOR_SHARED_SECRET=${executorSecret || '<reveal above>'}"`;

  const handleCopy = async (content: string, label: string) => {
    const success = await copyToClipboard(content);
    if (success) {
      toast({ title: "Copied", description: `${label} copied to clipboard` });
    } else {
      toast({ title: "Failed", description: "Could not copy to clipboard", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Terminal className="h-4 w-4" />
          Copy All Environment Variables
        </CardTitle>
        <CardDescription>
          Complete configuration command with all required variables
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!bothRevealed && (
          <Alert className="border-amber-500/50 bg-amber-500/10 py-2">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-sm text-amber-700 dark:text-amber-400">
              Reveal both secrets above to see complete values in the command
            </AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="windows" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="windows">Windows (NSSM)</TabsTrigger>
            <TabsTrigger value="linux">Linux (systemd)</TabsTrigger>
          </TabsList>
          
          <TabsContent value="windows" className="space-y-2">
            <div className="relative">
              <pre className="p-3 bg-muted rounded-lg text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                {windowsCommand}
              </pre>
              <Button
                variant="outline"
                size="sm"
                className="absolute top-2 right-2 h-7"
                onClick={() => handleCopy(windowsCommand, "Windows command")}
              >
                <Copy className="h-3 w-3 mr-1" />
                Copy
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Run this in an elevated PowerShell, then restart with: <code className="px-1 bg-muted rounded">nssm restart DellServerManagerJobExecutor</code>
            </p>
          </TabsContent>
          
          <TabsContent value="linux" className="space-y-2">
            <div className="relative">
              <pre className="p-3 bg-muted rounded-lg text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                {linuxEnvFile}
              </pre>
              <Button
                variant="outline"
                size="sm"
                className="absolute top-2 right-2 h-7"
                onClick={() => handleCopy(linuxEnvFile, "Linux config")}
              >
                <Copy className="h-3 w-3 mr-1" />
                Copy
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Add to <code className="px-1 bg-muted rounded">/etc/systemd/system/dell-job-executor.service.d/override.conf</code>, then: <code className="px-1 bg-muted rounded">sudo systemctl daemon-reload && sudo systemctl restart dell-job-executor</code>
            </p>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
