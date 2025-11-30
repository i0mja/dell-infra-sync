import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { validateNetworkPrerequisites } from "@/lib/network-validator";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTheme } from "next-themes";
import { Activity, AlertCircle, Bell, Briefcase, CheckCircle2, ChevronDown, ChevronRight, CloudCog, Copy, Database, Disc, FileText, Globe, Info, Loader2, Mail, MessageSquare, Monitor, Moon, Network, Palette, Plus, RefreshCw, Save, Server, Settings as SettingsIcon, Shield, ShieldAlert, Sun, Terminal, Users, X, XCircle } from "lucide-react";
import { ServerGroupsManagement } from "@/components/settings/ServerGroupsManagement";
import { IdentityProviderSettings } from "@/components/settings/IdentityProviderSettings";
import { AuditLogViewer } from "@/components/settings/AuditLogViewer";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DiagnosticsDialog } from "@/components/settings/DiagnosticsDialog";
import { JobExecutorDiagnostics } from "@/components/settings/JobExecutorDiagnostics";
import { IsoImageLibrary } from "@/components/settings/IsoImageLibrary";
import { FirmwareLibrary } from "@/components/settings/FirmwareLibrary";
import { useSearchParams } from "react-router-dom";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { getTabMetadata, settingsTabs, mapLegacyTabId } from "@/config/settings-tabs";
import { SettingsSection } from "@/components/settings/SettingsSection";

export default function Settings() {
  const isLocalMode = import.meta.env.VITE_SUPABASE_URL?.includes('127.0.0.1') || 
                      import.meta.env.VITE_SUPABASE_URL?.includes('localhost');
  const { user, userRole } = useAuth();
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  
  // Get default tab from query params or use 'general'
  const tabFromUrl = searchParams.get('tab');
  const sectionFromUrl = searchParams.get('section');
  
  // Map legacy tabs to new structure
  const mapped = mapLegacyTabId(tabFromUrl || 'appearance');
  const initialTab = mapped.tab;
  const initialSection = sectionFromUrl || mapped.section;
  
  const [activeTab, setActiveTab] = useState(initialTab);
  const [defaultOpenSection, setDefaultOpenSection] = useState(initialSection);

  // SMTP Settings
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpFromEmail, setSmtpFromEmail] = useState("");

  // Teams Settings
  const [teamsWebhookUrl, setTeamsWebhookUrl] = useState("");
  const [testingTeams, setTestingTeams] = useState(false);
  const [recentNotifications, setRecentNotifications] = useState<any[]>([]);
  const [teamsMentionUsers, setTeamsMentionUsers] = useState("");
  const [mentionOnCriticalFailures, setMentionOnCriticalFailures] = useState(true);
  const [criticalJobTypes, setCriticalJobTypes] = useState<string[]>(['firmware_update', 'full_server_update']);

  // Notification Preferences
  const [notifyOnJobComplete, setNotifyOnJobComplete] = useState(true);
  const [notifyOnJobFailed, setNotifyOnJobFailed] = useState(true);
  const [notifyOnJobStarted, setNotifyOnJobStarted] = useState(false);

  // OpenManage Settings
  const [omeSettingsId, setOmeSettingsId] = useState<string | null>(null);
  const [omeHost, setOmeHost] = useState("");
  const [omePort, setOmePort] = useState(443);
  const [omeUsername, setOmeUsername] = useState("");
  const [omePassword, setOmePassword] = useState("");
  const [omeVerifySSL, setOmeVerifySSL] = useState(true);
  const [omeSyncEnabled, setOmeSyncEnabled] = useState(false);
  const [omeLastSync, setOmeLastSync] = useState<string | null>(null);
  const [omeSyncing, setOmeSyncing] = useState(false);
  const [isOpenManageSyncing, setIsOpenManageSyncing] = useState(false);
  
  // API Token state
  const [apiTokens, setApiTokens] = useState<any[]>([]);
  const [newTokenName, setNewTokenName] = useState("");
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [showTokenDialog, setShowTokenDialog] = useState(false);

  // Activity Monitor Settings
  const [activitySettingsId, setActivitySettingsId] = useState<string | null>(null);
  // Job Executor is always enabled - iDRACs are always on private networks
  const useJobExecutorForIdrac = true;
  const [logRetentionDays, setLogRetentionDays] = useState(30);
  const [autoCleanupEnabled, setAutoCleanupEnabled] = useState(true);
  const [lastCleanupAt, setLastCleanupAt] = useState<string | null>(null);
  const [logLevel, setLogLevel] = useState<'all' | 'errors_only' | 'slow_only'>('all');
  const [slowCommandThreshold, setSlowCommandThreshold] = useState(5000);
  const [maxRequestBodyKb, setMaxRequestBodyKb] = useState(100);
  const [maxResponseBodyKb, setMaxResponseBodyKb] = useState(100);

  // iDRAC Safety Settings (kill switch & throttling)
  const [pauseIdracOperations, setPauseIdracOperations] = useState(false);
  const [discoveryMaxThreads, setDiscoveryMaxThreads] = useState(5);
  const [idracRequestDelayMs, setIdracRequestDelayMs] = useState(500);
  const [idracMaxConcurrent, setIdracMaxConcurrent] = useState(4);

  // Deployment Mode Detection
  const getDeploymentMode = () => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
    if (supabaseUrl.includes('supabase.co')) {
      return { mode: 'Cloud-Connected', color: 'bg-blue-500', description: 'Connected to Lovable Cloud' };
    }
    return { mode: 'Air-Gapped', color: 'bg-green-500', description: 'Self-hosted with local backend' };
  };

  const deploymentInfo = getDeploymentMode();
  const [alertOnFailures, setAlertOnFailures] = useState(true);
  const [alertOnSlowCommands, setAlertOnSlowCommands] = useState(false);
  const [keepStatistics, setKeepStatistics] = useState(true);
  const [statisticsRetentionDays, setStatisticsRetentionDays] = useState(365);
  const [cleaningUp, setCleaningUp] = useState(false);
  
  // Job Retention Settings
  const [jobRetentionDays, setJobRetentionDays] = useState(90);
  const [jobAutoCleanupEnabled, setJobAutoCleanupEnabled] = useState(true);
  const [jobLastCleanupAt, setJobLastCleanupAt] = useState<string | null>(null);
  const [jobCleaningUp, setJobCleaningUp] = useState(false);
  
  // Stale Job Settings
  const [stalePendingHours, setStalePendingHours] = useState(24);
  const [staleRunningHours, setStaleRunningHours] = useState(48);
  const [autoCancelStaleJobs, setAutoCancelStaleJobs] = useState(true);
  const [staleJobCount, setStaleJobCount] = useState(0);

  // SCP Share Settings (for older iDRAC firmware)
  const [scpShareEnabled, setScpShareEnabled] = useState(false);
  const [scpShareType, setScpShareType] = useState<'CIFS' | 'NFS'>('CIFS');
  const [scpSharePath, setScpSharePath] = useState("");
  const [scpShareUsername, setScpShareUsername] = useState("");
  const [scpSharePassword, setScpSharePassword] = useState("");

  // Scheduled cluster safety checks
  const [scheduledChecksEnabled, setScheduledChecksEnabled] = useState(false);
  const [checkFrequency, setCheckFrequency] = useState('0 */6 * * *');
  const [checkAllClusters, setCheckAllClusters] = useState(true);
  const [specificClusters, setSpecificClusters] = useState<string[]>([]);
  const [minRequiredHosts, setMinRequiredHosts] = useState(2);
  const [notifyOnUnsafeCluster, setNotifyOnUnsafeCluster] = useState(true);
  const [notifyOnClusterWarning, setNotifyOnClusterWarning] = useState(false);
  const [notifyOnClusterStatusChange, setNotifyOnClusterStatusChange] = useState(true);
  const [lastScheduledCheck, setLastScheduledCheck] = useState<any>(null);
  const [runningScheduledCheck, setRunningScheduledCheck] = useState(false);
  const [scheduledCheckId, setScheduledCheckId] = useState<string | null>(null);

  // Credential Sets State
  const [credentialSets, setCredentialSets] = useState<any[]>([]);
  const [editingCredential, setEditingCredential] = useState<any | null>(null);
  const [showCredentialDialog, setShowCredentialDialog] = useState(false);
  const [testingCredential, setTestingCredential] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [testIp, setTestIp] = useState("");

  // IP Range Management State
  const [showIpRangeDialog, setShowIpRangeDialog] = useState(false);
  const [selectedCredentialForIpRanges, setSelectedCredentialForIpRanges] = useState<any | null>(null);
  const [ipRanges, setIpRanges] = useState<any[]>([]);
  const [newIpRange, setNewIpRange] = useState("");
  const [newIpRangeDescription, setNewIpRangeDescription] = useState("");
  const [editingIpRange, setEditingIpRange] = useState<any | null>(null);
  
  // Temp state for inline IP range management in credential dialog
  const [tempIpRanges, setTempIpRanges] = useState<Array<{ start_ip: string; end_ip: string }>>([]);
  const [newInlineIpRange, setNewInlineIpRange] = useState({ start_ip: "", end_ip: "" });
  const [ipRangeExpanded, setIpRangeExpanded] = useState(false);

  // Form state for credential dialog
  const [credentialForm, setCredentialForm] = useState({
    name: '',
    username: '',
    password: '',
    description: '',
    priority: 100,
    is_default: false,
  });

  // Network Testing State
  const [servers, setServers] = useState<any[]>([]);
  const [vcenterSettings, setVCenterSettings] = useState<any | null>(null);
  const [testingServers, setTestingServers] = useState<Map<string, boolean>>(new Map());
  const [serverTestResults, setServerTestResults] = useState<Map<string, any>>(new Map());
  const [testingVCenter, setTestingVCenter] = useState(false);
  const [vcenterTestResult, setVCenterTestResult] = useState<any | null>(null);
  const [testingAllServers, setTestingAllServers] = useState(false);

  // Network Settings State
  const [networkSettingsId, setNetworkSettingsId] = useState<string | null>(null);
  const [connectionTimeout, setConnectionTimeout] = useState(30);
  const [readTimeout, setReadTimeout] = useState(60);
  const [operationTimeout, setOperationTimeout] = useState(300);
  const [maxRetryAttempts, setMaxRetryAttempts] = useState(3);
  const [retryBackoffType, setRetryBackoffType] = useState<'exponential' | 'linear' | 'fixed'>('exponential');
  const [retryDelay, setRetryDelay] = useState(2);
  const [maxConcurrentConnections, setMaxConcurrentConnections] = useState(5);
  const [maxRequestsPerMinute, setMaxRequestsPerMinute] = useState(60);
  const [requirePrereqValidation, setRequirePrereqValidation] = useState(true);
  const [monitorLatency, setMonitorLatency] = useState(true);
  const [latencyAlertThreshold, setLatencyAlertThreshold] = useState(1000);
  const [validatingPrereqs, setValidatingPrereqs] = useState(false);
  const [prereqResults, setPrereqResults] = useState<any | null>(null);

  // Virtual Media Settings
  const [vmSettingsId, setVmSettingsId] = useState<string | null>(null);
  const [vmShareType, setVmShareType] = useState<'nfs' | 'cifs' | 'http' | 'https'>('nfs');
  const [vmHost, setVmHost] = useState("");
  const [vmExportPath, setVmExportPath] = useState("");
  const [vmIsoPath, setVmIsoPath] = useState("");
  const [vmUseAuth, setVmUseAuth] = useState(false);
  const [vmUsername, setVmUsername] = useState("");
  const [vmPassword, setVmPassword] = useState("");
  const [vmNotes, setVmNotes] = useState("");
  const [vmTestResult, setVmTestResult] = useState<{ success: boolean; message: string; files?: string[]; baseUrl?: string; latency_ms?: number; port?: number; listing_error?: string; } | null>(null);
  const [testingVirtualMediaShare, setTestingVirtualMediaShare] = useState(false);

  // Job Executor Configuration
  const [serviceRoleKey, setServiceRoleKey] = useState<string | null>(null);
  const [loadingServiceKey, setLoadingServiceKey] = useState(false);
  const [serviceKeyCopied, setServiceKeyCopied] = useState(false);
  const [executionLog, setExecutionLog] = useState<any[]>([]);
  const [showExecutionLog, setShowExecutionLog] = useState(true);
  const [diagnosticsData, setDiagnosticsData] = useState<any | null>(null);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);
  const [showDiagnosticsDialog, setShowDiagnosticsDialog] = useState(false);

  useEffect(() => {
    loadSettings();
    loadApiTokens();
    fetchStaleJobCount();
    loadRecentNotifications();
    loadCredentialSets();
    loadServersAndVCenter();
    loadNetworkSettings();
    loadVirtualMediaSettings();
  }, []);

  const loadServersAndVCenter = async () => {
    // Load servers
    const { data: serversData } = await supabase
      .from('servers')
      .select('*')
      .order('hostname');
    if (serversData) setServers(serversData);

    // Load vCenter settings
    const { data: vcenterData } = await supabase
      .from('vcenter_settings')
      .select('*')
      .maybeSingle();
    if (vcenterData) setVCenterSettings(vcenterData);
  };

  const testIdracServer = async (serverId: string) => {
    const server = servers.find(s => s.id === serverId);
    if (!server) return;

    // Check if server has credentials assigned
    if (!server.credential_set_id) {
      toast({
        title: "Credentials Required",
        description: "Assign credentials to this server first",
        variant: "destructive",
      });
      return;
    }

    setTestingServers(new Map(testingServers.set(serverId, true)));
    
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const startTime = Date.now();
      
      // Create test_credentials job
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .insert([{
          job_type: 'test_credentials',
          target_scope: { ip_address: server.ip_address },
          credential_set_ids: [server.credential_set_id],
          created_by: user.id,
          status: 'pending'
        }])
        .select()
        .single();

      if (jobError) throw jobError;

      // Poll job status
      const pollInterval = setInterval(async () => {
        const { data: updatedJob } = await supabase
          .from('jobs')
          .select('*')
          .eq('id', job.id)
          .single();

        if (updatedJob?.status === 'completed') {
          clearInterval(pollInterval);
          const responseTime = Date.now() - startTime;
          const details = updatedJob.details as any;
          
          const testResult = {
            success: true,
            response_time_ms: details?.response_time_ms || responseTime,
            last_tested: new Date().toISOString(),
            error: undefined,
            version: details?.idrac_version,
          };

          setServerTestResults(new Map(serverTestResults.set(serverId, testResult)));
          setTestingServers(new Map(testingServers.set(serverId, false)));

          toast({
            title: "Connection Successful",
            description: `${server.hostname || server.ip_address} is online (${testResult.response_time_ms}ms)`,
          });
        } else if (updatedJob?.status === 'failed') {
          clearInterval(pollInterval);
          const details = updatedJob.details as any;
          
          const testResult = {
            success: false,
            response_time_ms: 0,
            last_tested: new Date().toISOString(),
            error: details?.message || 'Connection failed',
          };
          
          setServerTestResults(new Map(serverTestResults.set(serverId, testResult)));
          setTestingServers(new Map(testingServers.set(serverId, false)));

          toast({
            title: "Connection Failed",
            description: testResult.error,
            variant: "destructive",
          });
        }
      }, 2000);

      // Timeout after 30 seconds
      setTimeout(() => {
        clearInterval(pollInterval);
        if (testingServers.get(serverId)) {
          setTestingServers(new Map(testingServers.set(serverId, false)));
          toast({
            title: "Test Timed Out",
            description: "Job Executor may not be running",
            variant: "destructive",
          });
        }
      }, 30000);

    } catch (error: any) {
      const result = {
        success: false,
        response_time_ms: 0,
        last_tested: new Date().toISOString(),
        error: error.message,
      };
      setServerTestResults(new Map(serverTestResults.set(serverId, result)));
      setTestingServers(new Map(testingServers.set(serverId, false)));
      
      toast({
        title: "Connection Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const testAllServers = async () => {
    if (servers.length === 0) {
      toast({
        title: "No Servers",
        description: "Add servers first to test connectivity",
        variant: "destructive",
      });
      return;
    }

    setTestingAllServers(true);
    toast({
      title: "Testing All Servers",
      description: `Testing connectivity to ${servers.length} servers...`,
    });

    for (const server of servers) {
      await testIdracServer(server.id);
    }

    setTestingAllServers(false);
    toast({
      title: "Testing Complete",
      description: "All server connectivity tests completed",
    });
  };

  const testVCenterConnection = async () => {
    if (!vcenterSettings) {
      toast({
        title: "vCenter Not Configured",
        description: "Configure vCenter settings first",
        variant: "destructive",
      });
      return;
    }

    setTestingVCenter(true);
    
    try {
      // Call the edge function instead of direct browser fetch
      // This avoids CORS issues with vCenter API
      const { data, error } = await supabase.functions.invoke('test-vcenter-connection');
      
      if (error) {
        throw new Error(error.message);
      }

      setVCenterTestResult({
        success: true,
        response_time_ms: data.response_time_ms || 0,
        last_tested: new Date().toISOString(),
        version: data.version,
      });

      toast({
        title: "vCenter Connection Successful",
        description: `Connected to vCenter (${data.response_time_ms}ms)${data.version ? ` - Version: ${data.version}` : ''}`,
      });
    } catch (error: any) {
      setVCenterTestResult({
        success: false,
        response_time_ms: 0,
        last_tested: new Date().toISOString(),
        error: error.message,
      });
      
      toast({
        title: "vCenter Connection Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setTestingVCenter(false);
    }
  };

  // Sync activeTab with URL params when they change
  useEffect(() => {
    const tabFromUrl = searchParams.get('tab');
    const newTab = tabFromUrl === 'activity-monitor' ? 'activity' : tabFromUrl === 'jobs' ? 'jobs' : tabFromUrl || 'appearance';
    setActiveTab(newTab);
  }, [searchParams]);

  // Tab metadata for dynamic headers
  const tabMetadata = getTabMetadata();

  const loadRecentNotifications = async () => {
    const { data, error } = await supabase
      .from('notification_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (error) {
      console.error('Error loading notification logs:', error);
      return;
    }
    
    setRecentNotifications(data || []);
  };

  const handleTestTeamsNotification = async () => {
    if (!teamsWebhookUrl) {
      toast({
        title: "Webhook URL Required",
        description: "Please enter a Teams webhook URL before testing",
        variant: "destructive",
      });
      return;
    }

    setTestingTeams(true);
    try {
      const { data: result, error } = await supabase.functions.invoke('send-notification', {
        body: { isTest: true, testMessage: 'Test notification from Dell Server Manager' }
      });
      
      if (error) throw error;

      if (result?.success) {
        toast({
          title: "Test Notification Sent",
          description: "Check your Teams channel for the test message",
        });
        await loadRecentNotifications();
      } else {
        throw new Error(result?.error || 'Failed to send notification');
      }
    } catch (error: any) {
      toast({
        title: "Test Failed",
        description: error.message || "Failed to send test notification",
        variant: "destructive",
      });
    } finally {
      setTestingTeams(false);
    }
  };

  const loadApiTokens = async () => {
    const { data, error } = await supabase
      .from('api_tokens')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      toast({
        title: "Error loading API tokens",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    
    setApiTokens(data || []);
  };

  const generateApiToken = async () => {
    if (!newTokenName.trim()) {
      toast({
        title: "Token name required",
        description: "Please enter a name for your API token",
        variant: "destructive",
      });
      return;
    }

    // Generate a random token (32 bytes = 64 hex chars)
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = Array.from(tokenBytes, byte => byte.toString(16).padStart(2, '0')).join('');
    
    // Hash the token for storage
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const tokenHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const { error } = await supabase
      .from('api_tokens')
      .insert([{
        user_id: user?.id,
        name: newTokenName,
        token_hash: tokenHash,
      }] as any);

    if (error) {
      toast({
        title: "Error generating token",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    setGeneratedToken(token);
    setShowTokenDialog(true);
    setNewTokenName("");
    loadApiTokens();
    
    toast({
      title: "API token generated",
      description: "Make sure to copy it now, you won't be able to see it again",
    });
  };

  const deleteApiToken = async (tokenId: string) => {
    const { error } = await supabase
      .from('api_tokens')
      .delete()
      .eq('id', tokenId);

    if (error) {
      toast({
        title: "Error deleting token",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    loadApiTokens();
    toast({
      title: "Token deleted",
      description: "The API token has been revoked",
    });
  };

  const saveScheduledCheckConfig = async () => {
    if (userRole !== 'admin') {
      toast({
        title: "Permission Denied",
        description: "Only admins can modify scheduled check settings",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const configData = {
        enabled: scheduledChecksEnabled,
        schedule_cron: checkFrequency,
        check_all_clusters: checkAllClusters,
        specific_clusters: specificClusters,
        min_required_hosts: minRequiredHosts,
        notify_on_unsafe: notifyOnUnsafeCluster,
        notify_on_warnings: notifyOnClusterWarning,
        notify_on_safe_to_unsafe_change: notifyOnClusterStatusChange,
        updated_at: new Date().toISOString()
      };

      if (scheduledCheckId) {
        const { error } = await supabase
          .from('scheduled_safety_checks')
          .update(configData)
          .eq('id', scheduledCheckId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('scheduled_safety_checks')
          .insert(configData)
          .select()
          .single();
        if (error) throw error;
        setScheduledCheckId(data.id);
      }

      toast({
        title: "Success",
        description: "Scheduled check configuration saved",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const runScheduledChecksNow = async () => {
    setRunningScheduledCheck(true);
    try {
      const { error } = await supabase.rpc('run_scheduled_cluster_safety_checks');
      if (error) throw error;
      
      toast({
        title: "Checks Started",
        description: "Cluster safety checks are running. Check Activity Monitor for results.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setRunningScheduledCheck(false);
    }
  };

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase
        .from("notification_settings")
        .select("*")
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setSettingsId(data.id);
        setSmtpHost(data.smtp_host || "");
        setSmtpPort(data.smtp_port || 587);
        setSmtpUser(data.smtp_user || "");
        setSmtpPassword(data.smtp_password || "");
        setSmtpFromEmail(data.smtp_from_email || "");
      setTeamsWebhookUrl(data.teams_webhook_url || "");
      setNotifyOnJobComplete(data.notify_on_job_complete ?? true);
      setNotifyOnJobFailed(data.notify_on_job_failed ?? true);
      setNotifyOnJobStarted(data.notify_on_job_started ?? false);
      setTeamsMentionUsers(data.teams_mention_users || "");
      setMentionOnCriticalFailures(data.mention_on_critical_failures ?? true);
      setCriticalJobTypes(data.critical_job_types || ['firmware_update', 'full_server_update']);
      setTeamsMentionUsers(data.teams_mention_users || "");
      setMentionOnCriticalFailures(data.mention_on_critical_failures ?? true);
      setCriticalJobTypes(data.critical_job_types || ['firmware_update', 'full_server_update']);
      }
    } catch (error: any) {
      console.error("Error loading settings:", error);
      toast({
        title: "Error",
        description: "Failed to load notification settings",
        variant: "destructive",
      });
    }

    // Load scheduled safety check configuration
    try {
      const { data: scheduledCheckData } = await supabase
        .from('scheduled_safety_checks')
        .select('*')
        .single();

      if (scheduledCheckData) {
        setScheduledChecksEnabled(scheduledCheckData.enabled);
        setCheckFrequency(scheduledCheckData.schedule_cron);
        setCheckAllClusters(scheduledCheckData.check_all_clusters);
        setSpecificClusters(scheduledCheckData.specific_clusters || []);
        setMinRequiredHosts(scheduledCheckData.min_required_hosts);
        setNotifyOnUnsafeCluster(scheduledCheckData.notify_on_unsafe);
        setNotifyOnClusterWarning(scheduledCheckData.notify_on_warnings);
        setNotifyOnClusterStatusChange(scheduledCheckData.notify_on_safe_to_unsafe_change);
        setLastScheduledCheck(scheduledCheckData);
        setScheduledCheckId(scheduledCheckData.id);
      }
    } catch (error: any) {
      console.error("Error loading scheduled check settings:", error);
    }

    // Load OpenManage settings
    try {
      const { data: omeData, error: omeError } = await supabase
        .from("openmanage_settings")
        .select("*")
        .limit(1)
        .maybeSingle();

      if (omeError) throw omeError;

      if (omeData) {
        setOmeSettingsId(omeData.id);
        setOmeHost(omeData.host || "");
        setOmePort(omeData.port || 443);
        setOmeUsername(omeData.username || "");
        setOmePassword(omeData.password || "");
        setOmeVerifySSL(omeData.verify_ssl ?? true);
        setOmeSyncEnabled(omeData.sync_enabled ?? false);
        setOmeLastSync(omeData.last_sync);
      }
    } catch (error: any) {
      console.error("Error loading OpenManage settings:", error);
    }

    // Load Activity Monitor settings
    try {
      const { data: activityData, error: activityError } = await supabase
        .from("activity_settings")
        .select("*")
        .limit(1)
        .maybeSingle();

      if (activityError) throw activityError;

      if (activityData) {
        setActivitySettingsId(activityData.id);
        setLogRetentionDays(activityData.log_retention_days ?? 30);
        setAutoCleanupEnabled(activityData.auto_cleanup_enabled ?? true);
        setLastCleanupAt(activityData.last_cleanup_at);
        setLogLevel((activityData.log_level ?? 'all') as 'all' | 'errors_only' | 'slow_only');
        setSlowCommandThreshold(activityData.slow_command_threshold_ms ?? 5000);
        setMaxRequestBodyKb(activityData.max_request_body_kb ?? 100);
        setMaxResponseBodyKb(activityData.max_response_body_kb ?? 100);
        setAlertOnFailures(activityData.alert_on_failures ?? true);
        setAlertOnSlowCommands(activityData.alert_on_slow_commands ?? false);
        setKeepStatistics(activityData.keep_statistics ?? true);
        setStatisticsRetentionDays(activityData.statistics_retention_days ?? 365);
        setJobRetentionDays(activityData.job_retention_days ?? 90);
        setJobAutoCleanupEnabled(activityData.job_auto_cleanup_enabled ?? true);
        setJobLastCleanupAt(activityData.job_last_cleanup_at);
        setStalePendingHours(activityData.stale_pending_hours ?? 24);
        setStaleRunningHours(activityData.stale_running_hours ?? 48);
        setAutoCancelStaleJobs(activityData.auto_cancel_stale_jobs ?? true);
        // Load iDRAC safety settings
        setPauseIdracOperations(activityData.pause_idrac_operations ?? false);
        setDiscoveryMaxThreads(activityData.discovery_max_threads ?? 5);
        setIdracRequestDelayMs(activityData.idrac_request_delay_ms ?? 500);
        setIdracMaxConcurrent(activityData.idrac_max_concurrent ?? 4);
        // Load SCP Share settings (for older iDRAC firmware)
        setScpShareEnabled(activityData.scp_share_enabled ?? false);
        setScpShareType((activityData.scp_share_type as 'CIFS' | 'NFS') ?? 'CIFS');
        setScpSharePath(activityData.scp_share_path ?? "");
        setScpShareUsername(activityData.scp_share_username ?? "");
        setScpSharePassword(""); // Never load password from DB
        // useJobExecutorForIdrac is hardcoded to true - no longer stored in database
      }
    } catch (error: any) {
      console.error("Error loading activity settings:", error);
    }
  };

  const loadNetworkSettings = async () => {
    try {
      const { data, error } = await supabase
        .from("network_settings" as any)
        .select("*")
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        const settings = data as any;
        setNetworkSettingsId(settings.id);
        setConnectionTimeout(settings.connection_timeout_seconds ?? 30);
        setReadTimeout(settings.read_timeout_seconds ?? 60);
        setOperationTimeout(settings.operation_timeout_seconds ?? 300);
        setMaxRetryAttempts(settings.max_retry_attempts ?? 3);
        setRetryBackoffType((settings.retry_backoff_type ?? 'exponential') as 'exponential' | 'linear' | 'fixed');
        setRetryDelay(settings.retry_delay_seconds ?? 2);
        setMaxConcurrentConnections(settings.max_concurrent_connections ?? 5);
        setMaxRequestsPerMinute(settings.max_requests_per_minute ?? 60);
        setRequirePrereqValidation(settings.require_prereq_validation ?? true);
        setMonitorLatency(settings.monitor_latency ?? true);
        setLatencyAlertThreshold(settings.latency_alert_threshold_ms ?? 1000);
      }
    } catch (error: any) {
      console.error("Error loading network settings:", error);
    }
  };

  const handleSaveNetworkSettings = async () => {
    if (!networkSettingsId) {
      toast({
        title: "Error",
        description: "Network settings not initialized",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from("network_settings" as any)
        .update({
          connection_timeout_seconds: connectionTimeout,
          read_timeout_seconds: readTimeout,
          operation_timeout_seconds: operationTimeout,
          max_retry_attempts: maxRetryAttempts,
          retry_backoff_type: retryBackoffType,
          retry_delay_seconds: retryDelay,
          max_concurrent_connections: maxConcurrentConnections,
          max_requests_per_minute: maxRequestsPerMinute,
          require_prereq_validation: requirePrereqValidation,
          monitor_latency: monitorLatency,
          latency_alert_threshold_ms: latencyAlertThreshold,
        })
        .eq("id", networkSettingsId);

      if (error) throw error;

      toast({
        title: "Settings saved",
        description: "Network settings updated successfully",
      });
    } catch (error: any) {
      console.error("Error saving network settings:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to save network settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleValidatePrerequisites = async () => {
    setValidatingPrereqs(true);
    setPrereqResults(null);
    setExecutionLog([]);

    try {
      const result = await validateNetworkPrerequisites();

      setPrereqResults(result.results);
      setExecutionLog(result.executionLog || []);
      setShowExecutionLog(true);

      if (result.results.overallStatus === 'passed') {
        toast({
          title: "Validation Passed",
          description: "All network prerequisites are met",
        });
      } else {
        const failedCount = Object.values(result.results).filter((r: any) => r.tested && !r.passed).length;
        toast({
          title: "Validation Issues",
          description: `${failedCount} issue(s) found`,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error("Validation error:", error);
      toast({
        title: "Validation Failed",
        description: error.message || "Failed to validate network prerequisites",
        variant: "destructive",
      });
    } finally {
      setValidatingPrereqs(false);
    }
  };

  const loadVirtualMediaSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('virtual_media_settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setVmSettingsId(data.id);
        setVmShareType((data.share_type || 'nfs') as any);
        setVmHost(data.host || "");
        setVmExportPath(data.export_path || "");
        setVmIsoPath(data.iso_path || "");
        setVmUseAuth(data.use_auth ?? false);
        setVmUsername(data.username || "");
        setVmPassword(data.password || "");
        setVmNotes(data.notes || "");
      }
    } catch (error: any) {
      console.error("Error loading virtual media settings:", error);
    }
  };

  const handleSaveVirtualMediaSettings = async () => {
    if (!vmHost) {
      toast({
        title: "Host required",
        description: "Please provide the share host before saving",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const payload = {
        share_type: vmShareType,
        host: vmHost,
        export_path: vmExportPath,
        iso_path: vmIsoPath,
        use_auth: vmUseAuth,
        username: vmUseAuth ? vmUsername : null,
        password: vmUseAuth ? vmPassword : null,
        notes: vmNotes,
      };

      if (vmSettingsId) {
        const { error } = await supabase
          .from('virtual_media_settings')
          .update(payload)
          .eq('id', vmSettingsId);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('virtual_media_settings')
          .insert(payload)
          .select()
          .single();

        if (error) throw error;
        if (data) setVmSettingsId(data.id);
      }

      toast({
        title: "Settings saved",
        description: "Virtual media defaults updated",
      });
    } catch (error: any) {
      console.error("Error saving virtual media settings:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to save virtual media settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleTestVirtualMediaShare = async () => {
    if (!vmHost) {
      toast({
        title: "Share host required",
        description: "Enter a host to test virtual media connectivity",
        variant: "destructive",
      });
      return;
    }

    setTestingVirtualMediaShare(true);
    setVmTestResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('test-virtual-media-share', {
        body: {
          host: vmHost,
          export_path: vmExportPath,
          iso_path: vmIsoPath,
          share_type: vmShareType,
          username: vmUseAuth ? vmUsername : undefined,
          password: vmUseAuth ? vmPassword : undefined,
          list_files: true,
        }
      });

      if (error) throw error;

      const message = data?.success
        ? `Port ${data.port} reachable${data.latency_ms ? ` (${data.latency_ms}ms)` : ''}`
        : data?.error || 'Share not reachable';

      setVmTestResult({
        success: !!data?.success,
        message,
        files: data?.files || [],
        baseUrl: data?.base_url,
        latency_ms: data?.latency_ms,
        port: data?.port,
        listing_error: data?.listing_error,
      });

      if (data?.success) {
        toast({
          title: "Connectivity confirmed",
          description: message,
        });
      } else {
        toast({
          title: "Connectivity failed",
          description: message,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error("Error testing virtual media share:", error);
      toast({
        title: "Test failed",
        description: error.message || "Unable to reach share",
        variant: "destructive",
      });
    } finally {
      setTestingVirtualMediaShare(false);
    }
  };

  const copyExecutionLog = () => {
    const logText = executionLog.map(entry => 
      `[${new Date(entry.timestamp).toLocaleTimeString()}] ${entry.status.toUpperCase()} ${entry.method} ${entry.target} ${entry.response_time_ms}ms${entry.details ? ' - ' + entry.details : ''}`
    ).join('\n');
    navigator.clipboard.writeText(logText);
    toast({
      title: "Log Copied",
      description: "Execution log copied to clipboard",
    });
  };

  const loadDiagnostics = async () => {
    setLoadingDiagnostics(true);

    try {
      const { data: diagnosticsResult, error } = await supabase.functions.invoke('network-diagnostics');
      
      if (error) throw error;

      setDiagnosticsData(diagnosticsResult);
    } catch (error: any) {
      console.error("Diagnostics error:", error);
      toast({
        title: "Error",
        description: "Failed to load network diagnostics",
        variant: "destructive",
      });
    } finally {
      setLoadingDiagnostics(false);
    }
  };

  const handleSaveSettings = async () => {
    if (userRole !== "admin") {
      toast({
        title: "Permission Denied",
        description: "Only admins can modify notification settings",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const settingsData = {
        smtp_host: smtpHost || null,
        smtp_port: smtpPort,
        smtp_user: smtpUser || null,
        smtp_password: smtpPassword || null,
        smtp_from_email: smtpFromEmail || null,
        teams_webhook_url: teamsWebhookUrl || null,
        notify_on_job_complete: notifyOnJobComplete,
        notify_on_job_failed: notifyOnJobFailed,
        notify_on_job_started: notifyOnJobStarted,
        teams_mention_users: teamsMentionUsers || null,
        mention_on_critical_failures: mentionOnCriticalFailures,
        critical_job_types: criticalJobTypes,
      };

      if (settingsId) {
        const { error } = await supabase
          .from("notification_settings")
          .update(settingsData)
          .eq("id", settingsId);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("notification_settings")
          .insert(settingsData)
          .select()
          .single();

        if (error) throw error;
        setSettingsId(data.id);
      }

      toast({
        title: "Success",
        description: "Notification settings saved successfully",
      });
    } catch (error: any) {
      console.error("Error saving settings:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to save notification settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveOmeSettings = async () => {
    if (userRole !== "admin") {
      toast({
        title: "Permission Denied",
        description: "Only admins can modify OpenManage settings",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const omeData = {
        host: omeHost,
        port: omePort,
        username: omeUsername,
        password: omePassword,
        verify_ssl: omeVerifySSL,
        sync_enabled: omeSyncEnabled,
      };

      if (omeSettingsId) {
        const { error } = await supabase
          .from("openmanage_settings")
          .update(omeData)
          .eq("id", omeSettingsId);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("openmanage_settings")
          .insert(omeData)
          .select()
          .single();

        if (error) throw error;
        setOmeSettingsId(data.id);
      }

      toast({
        title: "Success",
        description: "OpenManage settings saved successfully",
      });
    } catch (error: any) {
      console.error("Error saving OpenManage settings:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to save OpenManage settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveActivitySettings = async () => {
    if (userRole !== "admin") {
      toast({
        title: "Permission Denied",
        description: "Only admins can modify activity settings",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      // Prepare activity data
      const activityData: any = {
        log_retention_days: logRetentionDays,
        auto_cleanup_enabled: autoCleanupEnabled,
        log_level: logLevel,
        slow_command_threshold_ms: slowCommandThreshold,
        max_request_body_kb: maxRequestBodyKb,
        max_response_body_kb: maxResponseBodyKb,
        alert_on_failures: alertOnFailures,
        alert_on_slow_commands: alertOnSlowCommands,
        keep_statistics: keepStatistics,
        statistics_retention_days: statisticsRetentionDays,
        job_retention_days: jobRetentionDays,
        job_auto_cleanup_enabled: jobAutoCleanupEnabled,
        stale_pending_hours: stalePendingHours,
        stale_running_hours: staleRunningHours,
        auto_cancel_stale_jobs: autoCancelStaleJobs,
        // iDRAC safety settings
        pause_idrac_operations: pauseIdracOperations,
        discovery_max_threads: discoveryMaxThreads,
        idrac_request_delay_ms: idracRequestDelayMs,
        idrac_max_concurrent: idracMaxConcurrent,
        // SCP Share settings (for older iDRAC firmware)
        scp_share_enabled: scpShareEnabled,
        scp_share_type: scpShareType,
        scp_share_path: scpSharePath.trim() || null,
        scp_share_username: scpShareUsername.trim() || null,
        // use_job_executor_for_idrac removed - always true
      };

      // Encrypt and add password if provided
      if (scpSharePassword.trim()) {
        const { data: encryptedPassword, error: encryptError } = await supabase.functions.invoke('encrypt-credentials', {
          body: { 
            password: scpSharePassword.trim(),
            type: 'activity_settings'
          }
        });
        if (encryptError) throw encryptError;
        activityData.scp_share_password_encrypted = encryptedPassword.encrypted;
      }

      if (activitySettingsId) {
        const { error } = await supabase
          .from("activity_settings")
          .update(activityData)
          .eq("id", activitySettingsId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("activity_settings")
          .insert(activityData)
          .select()
          .single();
        if (error) throw error;
        setActivitySettingsId(data.id);
      }

      toast({
        title: "Success",
        description: "Activity Monitor settings saved successfully",
      });
    } catch (error: any) {
      console.error("Error saving activity settings:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to save activity settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCleanupNow = async () => {
    if (userRole !== "admin") {
      toast({
        title: "Permission Denied",
        description: "Only admins can trigger cleanup",
        variant: "destructive",
      });
      return;
    }

    setCleaningUp(true);
    try {
      const { error } = await supabase.functions.invoke('cleanup-activity-logs');
      
      if (error) throw error;

      toast({
        title: "Cleanup Complete",
        description: "Old activity log entries have been deleted",
      });
      
      // Reload settings to get updated last_cleanup_at
      loadSettings();
    } catch (error: any) {
      console.error("Error triggering cleanup:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to trigger cleanup",
        variant: "destructive",
      });
    } finally {
      setCleaningUp(false);
    }
  };

  const handleJobCleanupNow = async () => {
    if (userRole !== "admin") {
      toast({
        title: "Permission Denied",
        description: "Only admins can trigger job cleanup",
        variant: "destructive",
      });
      return;
    }

    setJobCleaningUp(true);
    try {
      const { error } = await supabase.functions.invoke('cleanup-old-jobs');
      
      if (error) throw error;
      
      // Query to get the actual counts
      const deletedCount = 0; // Will be shown in activity logs
      const cancelledCount = 0;
      const message = cancelledCount > 0 
        ? `Deleted ${deletedCount} old jobs and cancelled ${cancelledCount} stale jobs`
        : `Deleted ${deletedCount} old jobs`;

      toast({
        title: "Job Cleanup Complete",
        description: message,
      });
      
      // Reload settings to get updated last_cleanup_at
      loadSettings();
      fetchStaleJobCount();
    } catch (error: any) {
      console.error("Error triggering job cleanup:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to trigger job cleanup",
        variant: "destructive",
      });
    } finally {
      setJobCleaningUp(false);
    }
  };

  const fetchStaleJobCount = async () => {
    try {
      const { data: activityData } = await supabase
        .from('activity_settings')
        .select('stale_pending_hours, stale_running_hours')
        .limit(1)
        .maybeSingle();

      if (!activityData) return;

      const stalePendingCutoff = new Date();
      stalePendingCutoff.setHours(stalePendingCutoff.getHours() - activityData.stale_pending_hours);
      
      const staleRunningCutoff = new Date();
      staleRunningCutoff.setHours(staleRunningCutoff.getHours() - activityData.stale_running_hours);

      const { count: pendingCount } = await supabase
        .from('jobs')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')
        .lt('created_at', stalePendingCutoff.toISOString());

      const { count: runningCount } = await supabase
        .from('jobs')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'running')
        .lt('started_at', staleRunningCutoff.toISOString());

      setStaleJobCount((pendingCount || 0) + (runningCount || 0));
    } catch (error: any) {
      console.error("Error fetching stale job count:", error);
    }
  };

  const handleCancelStaleJobsNow = async () => {
    if (userRole !== "admin") {
      toast({
        title: "Permission Denied",
        description: "Only admins can cancel stale jobs",
        variant: "destructive",
      });
      return;
    }

    if (staleJobCount === 0) {
      toast({
        title: "No Stale Jobs",
        description: "There are no stale jobs to cancel",
      });
      return;
    }

    setJobCleaningUp(true);
    try {
      const { error } = await supabase.functions.invoke('cleanup-old-jobs');
      
      if (error) throw error;

      toast({
        title: "Stale Jobs Cancelled",
        description: "Stale jobs have been cancelled",
      });
      
      fetchStaleJobCount();
    } catch (error: any) {
      console.error("Error cancelling stale jobs:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to cancel stale jobs",
        variant: "destructive",
      });
    } finally {
      setJobCleaningUp(false);
    }
  };

  const handleSyncNow = async () => {
    if (userRole !== "admin" && userRole !== "operator") {
      toast({
        title: "Permission Denied",
        description: "Only admins and operators can trigger sync",
        variant: "destructive",
      });
      return;
    }

    if (!omeHost || !omeUsername || !omePassword) {
      toast({
        title: "Configuration Required",
        description: "Please configure OpenManage settings first",
        variant: "destructive",
      });
      return;
    }

    setIsOpenManageSyncing(true);
    try {
      // Create openmanage_sync job using edge function
      const { data: result, error: jobError } = await supabase.functions.invoke('create-job', {
        body: {
          job_type: 'openmanage_sync' as any,
          created_by: user?.id,
          target_scope: { type: 'all' },
          details: { triggered_by: 'manual' }
        }
      });
      
      if (jobError) throw jobError;
      if (!result?.success) throw new Error(result?.error || 'Failed to create job');
      
      const jobId = result.job_id;
      
      toast({
        title: "OpenManage Sync Started",
        description: `Job ${jobId.substring(0, 8)} created. Syncing devices from OpenManage...`,
      });
      
      // Poll job status
      const pollInterval = setInterval(async () => {
        const { data: job } = await supabase
          .from('jobs')
          .select('status, details')
          .eq('id', jobId)
          .single();
        
        if (job?.status === 'completed') {
          clearInterval(pollInterval);
          setIsOpenManageSyncing(false);
          const details = job.details as any;
          toast({
            title: "OpenManage Sync Completed",
            description: `✓ ${details?.new || 0} new servers, ${details?.updated || 0} updated`,
          });
          // Reload OME last_sync timestamp
          const { data: omeData } = await supabase
            .from('openmanage_settings')
            .select('last_sync')
            .limit(1)
            .single();
          if (omeData?.last_sync) {
            setOmeLastSync(omeData.last_sync);
          }
        } else if (job?.status === 'failed') {
          clearInterval(pollInterval);
          setIsOpenManageSyncing(false);
          const details = job.details as any;
          toast({
            title: "OpenManage Sync Failed",
            description: details?.error || "Unknown error occurred",
            variant: "destructive",
          });
        }
      }, 2000);
      
      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        if (isOpenManageSyncing) {
          setIsOpenManageSyncing(false);
          toast({
            title: "Sync Timed Out",
            description: "Job Executor may not be running or sync is taking longer than expected",
            variant: "destructive",
          });
        }
      }, 300000);
      
    } catch (error: any) {
      console.error("Error triggering sync:", error);
      setIsOpenManageSyncing(false);
      toast({
        title: "Error",
        description: error.message || "Failed to trigger sync",
        variant: "destructive",
      });
    }
  };

  // Credential Management Functions
  const loadCredentialSets = async () => {
    try {
      const { data, error } = await supabase
        .from('credential_sets')
        .select(`
          *,
          credential_ip_ranges (
            id,
            ip_range,
            description,
            priority
          )
        `)
        .order('priority', { ascending: true });
      
      if (error) throw error;
      setCredentialSets(data || []);
    } catch (error: any) {
      toast({
        title: "Error loading credential sets",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  // IP Range Management Functions
  const loadIpRanges = async (credentialSetId: string) => {
    try {
      const { data, error } = await supabase
        .from('credential_ip_ranges' as any)
        .select('*')
        .eq('credential_set_id', credentialSetId)
        .order('priority', { ascending: true });
      
      if (error) throw error;
      setIpRanges(data || []);
    } catch (error: any) {
      toast({
        title: "Error loading IP ranges",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const openIpRangeDialog = async (credentialSet: any) => {
    setSelectedCredentialForIpRanges(credentialSet);
    await loadIpRanges(credentialSet.id);
    setShowIpRangeDialog(true);
  };

  const handleAddIpRange = async () => {
    if (!newIpRange || !selectedCredentialForIpRanges) {
      toast({
        title: "Missing Required Fields",
        description: "Please enter an IP range",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('credential_ip_ranges' as any)
        .insert({
          credential_set_id: selectedCredentialForIpRanges.id,
          ip_range: newIpRange,
          description: newIpRangeDescription || null,
          priority: 100,
        } as any);
      
      if (error) throw error;
      
      toast({
        title: "IP Range Added",
        description: "The IP range has been added successfully",
      });
      
      setNewIpRange("");
      setNewIpRangeDescription("");
      await loadIpRanges(selectedCredentialForIpRanges.id);
      await loadCredentialSets();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateIpRange = async () => {
    if (!editingIpRange || !newIpRange) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('credential_ip_ranges' as any)
        .update({
          ip_range: newIpRange,
          description: newIpRangeDescription || null,
        })
        .eq('id', editingIpRange.id);
      
      if (error) throw error;
      
      toast({
        title: "IP Range Updated",
        description: "The IP range has been updated successfully",
      });
      
      setEditingIpRange(null);
      setNewIpRange("");
      setNewIpRangeDescription("");
      if (selectedCredentialForIpRanges) {
        await loadIpRanges(selectedCredentialForIpRanges.id);
        await loadCredentialSets();
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteIpRange = async (id: string) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('credential_ip_ranges' as any)
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      
      toast({
        title: "IP Range Deleted",
        description: "The IP range has been removed",
      });
      
      if (selectedCredentialForIpRanges) {
        await loadIpRanges(selectedCredentialForIpRanges.id);
        await loadCredentialSets();
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const startEditIpRange = (range: any) => {
    setEditingIpRange(range);
    setNewIpRange(range.ip_range);
    setNewIpRangeDescription(range.description || "");
  };

  const cancelEditIpRange = () => {
    setEditingIpRange(null);
    setNewIpRange("");
    setNewIpRangeDescription("");
  };

  const handleSaveCredential = async () => {
    if (!credentialForm.name || !credentialForm.username) {
      toast({
        title: "Missing Required Fields",
        description: "Please fill in name and username",
        variant: "destructive",
      });
      return;
    }

    if (!editingCredential && !credentialForm.password) {
      toast({
        title: "Password Required",
        description: "Password is required when creating a new credential set",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      if (editingCredential) {
        // Update existing credential set
        const payload: any = {
          name: credentialForm.name,
          username: credentialForm.username,
          description: credentialForm.description || null,
          priority: credentialForm.priority,
          is_default: credentialForm.is_default,
        };

        // Update basic fields (without password)
        const { error } = await supabase
          .from('credential_sets')
          .update(payload)
          .eq('id', editingCredential.id);
        
        if (error) throw error;

        // If password provided, encrypt it separately
        if (credentialForm.password) {
          const { error: encryptError } = await supabase.functions.invoke('encrypt-credentials', {
            body: {
              type: 'credential_set',
              credential_set_id: editingCredential.id,
              password: credentialForm.password,
            }
          });

          if (encryptError) {
            throw new Error('Failed to encrypt password: ' + encryptError.message);
          }
        }

        // Handle IP ranges - delete existing and insert new ones
        await supabase
          .from('credential_ip_ranges')
          .delete()
          .eq('credential_set_id', editingCredential.id);

        if (tempIpRanges.length > 0) {
          const { error: rangeError } = await supabase
            .from('credential_ip_ranges')
            .insert(
              tempIpRanges.map((range, idx) => ({
                credential_set_id: editingCredential.id,
                ip_range: `${range.start_ip}-${range.end_ip}`,
                priority: idx + 1,
              }))
            );

          if (rangeError) {
            console.error("Error updating IP ranges:", rangeError);
          }
        }
        
        toast({
          title: "Credential Set Updated",
          description: `${credentialForm.name} has been updated successfully`,
        });
      } else {
        // Create new credential set WITHOUT password first
        const payload: any = {
          name: credentialForm.name,
          username: credentialForm.username,
          description: credentialForm.description || null,
          priority: credentialForm.priority,
          is_default: credentialForm.is_default,
          password_encrypted: null, // Will be encrypted via edge function
        };

        const { data: newCred, error } = await supabase
          .from('credential_sets')
          .insert(payload)
          .select()
          .single();
        
        if (error) throw error;

        // Encrypt password via edge function
        const { error: encryptError } = await supabase.functions.invoke('encrypt-credentials', {
          body: {
            type: 'credential_set',
            credential_set_id: newCred.id,
            password: credentialForm.password,
          }
        });

        if (encryptError) {
          // Clean up credential set if encryption fails
          await supabase.from("credential_sets").delete().eq('id', newCred.id);
          throw new Error('Failed to encrypt credentials: ' + encryptError.message);
        }

        // Insert IP ranges if any
        if (tempIpRanges.length > 0) {
          const { error: rangeError } = await supabase
            .from('credential_ip_ranges')
            .insert(
              tempIpRanges.map((range, idx) => ({
                credential_set_id: newCred.id,
                ip_range: `${range.start_ip}-${range.end_ip}`,
                priority: idx + 1,
              }))
            );

          if (rangeError) {
            console.error("Error adding IP ranges:", rangeError);
          }
        }
        
        toast({
          title: "Credential Set Created",
          description: `${credentialForm.name} has been created successfully`,
        });
      }

      setShowCredentialDialog(false);
      setEditingCredential(null);
      setCredentialForm({
        name: '',
        username: '',
        password: '',
        description: '',
        priority: 100,
        is_default: false,
      });
      setTempIpRanges([]);
      setNewInlineIpRange({ start_ip: "", end_ip: "" });
      setIpRangeExpanded(false);
      loadCredentialSets();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCredential = async (id: string) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('credential_sets')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      
      toast({
        title: "Credential Set Deleted",
        description: "The credential set has been removed",
      });
      
      setDeleteConfirmId(null);
      loadCredentialSets();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleTestCredential = async (credentialSet: any) => {
    if (!testIp) {
      toast({
        title: "IP Address Required",
        description: "Please enter an IP address to test against",
        variant: "destructive",
      });
      return;
    }

    setTestingCredential(credentialSet.id);
    
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Create test_credentials job
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .insert([{
          job_type: 'test_credentials',
          target_scope: { ip_address: testIp },
          credential_set_ids: [credentialSet.id],
          created_by: user.id,
          status: 'pending'
        }])
        .select()
        .single();

      if (jobError) throw jobError;

      // Poll job status
      const pollInterval = setInterval(async () => {
        const { data: updatedJob } = await supabase
          .from('jobs')
          .select('*')
          .eq('id', job.id)
          .single();

        if (updatedJob?.status === 'completed') {
          clearInterval(pollInterval);
          setTestingCredential(null);
          
          toast({
            title: "Connection Successful",
            description: `Connected to ${testIp} successfully`,
          });
        } else if (updatedJob?.status === 'failed') {
          clearInterval(pollInterval);
          setTestingCredential(null);
          
          const details = updatedJob.details as any;
          throw new Error(details?.message || 'Connection failed');
        }
      }, 2000);

      // Timeout after 30 seconds
      setTimeout(() => {
        clearInterval(pollInterval);
        if (testingCredential === credentialSet.id) {
          setTestingCredential(null);
          toast({
            title: "Test Timed Out",
            description: "Job Executor may not be running - check Activity Monitor",
            variant: "destructive",
          });
        }
      }, 30000);

    } catch (error: any) {
      setTestingCredential(null);
      toast({
        title: "Connection Failed",
        description: error.message || "Failed to connect with these credentials",
        variant: "destructive",
      });
    }
  };

  const fetchServiceRoleKey = async () => {
    setLoadingServiceKey(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-service-key');
      
      if (error) throw error;
      
      setServiceRoleKey(data.service_role_key);
      toast({
        title: "Service Role Key Retrieved",
        description: "Copy this key to your Job Executor .env file",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to retrieve service role key",
        variant: "destructive",
      });
    } finally {
      setLoadingServiceKey(false);
    }
  };

  const copyServiceRoleKey = () => {
    if (serviceRoleKey) {
      navigator.clipboard.writeText(serviceRoleKey);
      setServiceKeyCopied(true);
      toast({
        title: "Copied!",
        description: "Service role key copied to clipboard",
      });
      setTimeout(() => setServiceKeyCopied(false), 2000);
    }
  };

  const handleMovePriority = async (id: string, direction: 'up' | 'down') => {
    const index = credentialSets.findIndex(cs => cs.id === id);
    if (index === -1) return;
    
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= credentialSets.length) return;
    
    const currentSet = credentialSets[index];
    const targetSet = credentialSets[targetIndex];
    
    setLoading(true);
    try {
      // Swap priorities
      const updates = [
        supabase
          .from('credential_sets')
          .update({ priority: targetSet.priority })
          .eq('id', currentSet.id),
        supabase
          .from('credential_sets')
          .update({ priority: currentSet.priority })
          .eq('id', targetSet.id),
      ];
      
      await Promise.all(updates);
      
      toast({
        title: "Priority Updated",
        description: "Credential set order has been changed",
      });
      
      loadCredentialSets();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSetDefault = async (id: string) => {
    setLoading(true);
    try {
      // First, unset all defaults
      await supabase
        .from('credential_sets')
        .update({ is_default: false })
        .neq('id', '00000000-0000-0000-0000-000000000000');
      
      // Then set the selected one as default
      const { error } = await supabase
        .from('credential_sets')
        .update({ is_default: true })
        .eq('id', id);
      
      if (error) throw error;
      
      toast({
        title: "Default Credential Set",
        description: "This credential set is now the default",
      });
      
      loadCredentialSets();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return null;
  }

  if (userRole !== "admin") {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              Only administrators can access settings.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          {tabMetadata[activeTab]?.icon && (
            <div className="text-primary">
              {(() => {
                const IconComponent = tabMetadata[activeTab].icon;
                return <IconComponent className="h-8 w-8" />;
              })()}
            </div>
          )}
          <h1 className="text-3xl font-bold">
            {tabMetadata[activeTab]?.title || "Settings"}
          </h1>
        </div>
        <p className="text-muted-foreground">
          {tabMetadata[activeTab]?.description || "Manage your application settings"}
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5 mb-6">
          {settingsTabs.map(tab => {
            const Icon = tab.icon;
            return (
              <TabsTrigger key={tab.id} value={tab.id} className="flex items-center gap-2">
                <Icon className="h-4 w-4" />
                {tab.name}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* GENERAL TAB */}
        <TabsContent value="general" className="space-y-4">
          <SettingsSection
            id="appearance"
            title="Appearance"
            description="Customize the look and feel of the application"
            icon={Palette}
            defaultOpen={defaultOpenSection === 'appearance'}
          >
            <div className="space-y-4">
              <Card>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <Label>Theme</Label>
                    <p className="text-sm text-muted-foreground">
                      Choose your preferred color scheme
                    </p>
                    <div className="grid grid-cols-3 gap-4">
                      <Button
                        variant={theme === "light" ? "default" : "outline"}
                        onClick={() => setTheme("light")}
                        className="flex items-center gap-2"
                      >
                        <Sun className="h-4 w-4" />
                        Light
                      </Button>
                      <Button
                        variant={theme === "dark" ? "default" : "outline"}
                        onClick={() => setTheme("dark")}
                        className="flex items-center gap-2"
                      >
                        <Moon className="h-4 w-4" />
                        Dark
                      </Button>
                      <Button
                        variant={theme === "system" ? "default" : "outline"}
                        onClick={() => setTheme("system")}
                        className="flex items-center gap-2"
                      >
                        <Monitor className="h-4 w-4" />
                        System
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </SettingsSection>
        </TabsContent>

        {/* SECURITY & ACCESS TAB */}
        <TabsContent value="security" className="space-y-4">
          {/* Credentials */}
          <SettingsSection
            id="credentials"
            title="Credentials"
            description="Manage iDRAC and ESXi credential sets with IP range auto-assignment"
            icon={Shield}
            defaultOpen={defaultOpenSection === 'credentials'}
          >
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <div>
                  <h4 className="text-sm font-medium">Credential Sets</h4>
                  <p className="text-sm text-muted-foreground">
                    Create reusable credential sets for iDRAC and ESXi servers
                  </p>
                </div>
                <Button onClick={() => {
                  setEditingCredential(null);
                  setCredentialForm({
                    name: '',
                    username: '',
                    password: '',
                    description: '',
                    priority: 100,
                    is_default: false,
                  });
                  setTempIpRanges([]);
                  setShowCredentialDialog(true);
                }}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Credential Set
                </Button>
              </div>

              {credentialSets.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Shield className="h-12 w-12 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground text-center">
                      No credential sets configured. Add your first credential set to get started.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {credentialSets.map((cred) => (
                    <Card key={cred.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-medium">{cred.name}</h4>
                              {cred.is_default && (
                                <Badge variant="secondary">Default</Badge>
                              )}
                              <Badge variant="outline">
                                {cred.credential_type === 'idrac' ? 'iDRAC' : 'ESXi'}
                              </Badge>
                            </div>
                            {cred.description && (
                              <p className="text-sm text-muted-foreground mb-2">{cred.description}</p>
                            )}
                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                              <span>Username: {cred.username}</span>
                              <span>Priority: {cred.priority}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setEditingCredential(cred);
                                setCredentialForm({
                                  name: cred.name,
                                  username: cred.username,
                                  password: '',
                                  description: cred.description || '',
                                  priority: cred.priority || 100,
                                  is_default: cred.is_default || false,
                                });
                                loadIpRanges(cred.id).then(() => {
                                  // Convert loaded ipRanges to tempIpRanges format for inline editing
                                  setTempIpRanges(ipRanges.map(r => ({ 
                                    start_ip: r.ip_range.split('-')[0]?.trim() || '', 
                                    end_ip: r.ip_range.split('-')[1]?.trim() || r.ip_range 
                                  })));
                                });
                                setShowCredentialDialog(true);
                              }}
                            >
                              Edit
                            </Button>
                            {testingCredential === cred.id ? (
                              <Button variant="outline" size="sm" disabled>
                                <Loader2 className="h-4 w-4 animate-spin" />
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setTestingCredential(cred.id);
                                  setTestIp("");
                                }}
                              >
                                Test
                              </Button>
                            )}
                            {deleteConfirmId === cred.id ? (
                              <div className="flex gap-1">
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={async () => {
                                    const { error } = await supabase
                                      .from('credential_sets')
                                      .delete()
                                      .eq('id', cred.id);

                                    if (error) {
                                      toast({
                                        title: "Error",
                                        description: error.message,
                                        variant: "destructive",
                                      });
                                    } else {
                                      toast({
                                        title: "Success",
                                        description: "Credential set deleted",
                                      });
                                      loadCredentialSets();
                                    }
                                    setDeleteConfirmId(null);
                                  }}
                                >
                                  Confirm
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setDeleteConfirmId(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteConfirmId(cred.id)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                        {testingCredential === cred.id && (
                          <div className="mt-3 pt-3 border-t">
                            <Label htmlFor={`test-ip-${cred.id}`}>Test IP Address</Label>
                            <div className="flex gap-2 mt-1">
                              <Input
                                id={`test-ip-${cred.id}`}
                                placeholder="192.168.1.100"
                                value={testIp}
                                onChange={(e) => setTestIp(e.target.value)}
                              />
                              <Button
                                onClick={async () => {
                                  if (!testIp) {
                                    toast({
                                      title: "IP Required",
                                      description: "Enter an IP address to test",
                                      variant: "destructive",
                                    });
                                    return;
                                  }
                                  await handleTestCredential(cred);
                                }}
                              >
                                Test Connection
                              </Button>
                              <Button
                                variant="outline"
                                onClick={() => setTestingCredential(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {/* Credential Dialog */}
              <Dialog open={showCredentialDialog} onOpenChange={setShowCredentialDialog}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>
                      {editingCredential ? 'Edit' : 'Add'} Credential Set
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="cred-name">Name *</Label>
                      <Input
                        id="cred-name"
                        value={credentialForm.name}
                        onChange={(e) => setCredentialForm({ ...credentialForm, name: e.target.value })}
                        placeholder="Production iDRAC Credentials"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="cred-username">Username *</Label>
                      <Input
                        id="cred-username"
                        value={credentialForm.username}
                        onChange={(e) => setCredentialForm({ ...credentialForm, username: e.target.value })}
                        placeholder="root"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="cred-password">Password *</Label>
                      <Input
                        id="cred-password"
                        type="password"
                        value={credentialForm.password}
                        onChange={(e) => setCredentialForm({ ...credentialForm, password: e.target.value })}
                        placeholder={editingCredential ? "Leave blank to keep current" : "••••••••"}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="cred-description">Description</Label>
                      <Textarea
                        id="cred-description"
                        value={credentialForm.description}
                        onChange={(e) => setCredentialForm({ ...credentialForm, description: e.target.value })}
                        placeholder="Optional description"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="cred-priority">Priority</Label>
                      <Input
                        id="cred-priority"
                        type="number"
                        value={credentialForm.priority}
                        onChange={(e) => setCredentialForm({ ...credentialForm, priority: parseInt(e.target.value) || 100 })}
                      />
                      <p className="text-sm text-muted-foreground">
                        Lower numbers = higher priority (used when multiple credentials match)
                      </p>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Set as Default</Label>
                        <p className="text-sm text-muted-foreground">
                          Use for new servers without specific credentials
                        </p>
                      </div>
                      <Switch
                        checked={credentialForm.is_default}
                        onCheckedChange={(checked) => setCredentialForm({ ...credentialForm, is_default: checked })}
                      />
                    </div>

                    <Collapsible open={ipRangeExpanded} onOpenChange={setIpRangeExpanded}>
                      <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium">
                        {ipRangeExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        IP Range Auto-Assignment ({tempIpRanges.length} ranges)
                      </CollapsibleTrigger>
                      <CollapsibleContent className="space-y-3 mt-3">
                        <p className="text-sm text-muted-foreground">
                          Define IP ranges where these credentials should be automatically assigned
                        </p>
                        
                        {tempIpRanges.map((range, index) => (
                          <div key={index} className="flex items-center gap-2 p-2 border rounded">
                            <span className="text-sm flex-1">{range.start_ip} - {range.end_ip}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setTempIpRanges(tempIpRanges.filter((_, i) => i !== index))}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}

                        <div className="flex gap-2">
                          <Input
                            placeholder="Start IP (e.g., 192.168.1.1)"
                            value={newInlineIpRange.start_ip}
                            onChange={(e) => setNewInlineIpRange({ ...newInlineIpRange, start_ip: e.target.value })}
                          />
                          <Input
                            placeholder="End IP (e.g., 192.168.1.50)"
                            value={newInlineIpRange.end_ip}
                            onChange={(e) => setNewInlineIpRange({ ...newInlineIpRange, end_ip: e.target.value })}
                          />
                          <Button
                            variant="outline"
                            onClick={() => {
                              if (newInlineIpRange.start_ip && newInlineIpRange.end_ip) {
                                setTempIpRanges([...tempIpRanges, newInlineIpRange]);
                                setNewInlineIpRange({ start_ip: "", end_ip: "" });
                              }
                            }}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>

                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={() => setShowCredentialDialog(false)}>
                        Cancel
                      </Button>
                      <Button onClick={handleSaveCredential} disabled={loading}>
                        {loading ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </SettingsSection>

          {/* Identity Provider */}
          <SettingsSection
            id="identity-provider"
            title="Identity Provider"
            description="Configure LDAP/Active Directory authentication and user synchronization"
            icon={Users}
            defaultOpen={defaultOpenSection === 'identity-provider'}
          >
            <IdentityProviderSettings />
          </SettingsSection>

          {/* Audit Logs */}
          <SettingsSection
            id="audit-logs"
            title="Audit Logs"
            description="View security audit logs and authentication events"
            icon={FileText}
            defaultOpen={defaultOpenSection === 'audit-logs'}
          >
            <AuditLogViewer />
          </SettingsSection>

          {/* Operations Safety */}
          <SettingsSection
            id="operations-safety"
            title="Operations Safety"
            description="Emergency controls and throttling for iDRAC operations"
            icon={ShieldAlert}
            defaultOpen={defaultOpenSection === 'operations-safety'}
          >
            <div className="space-y-6">
              <Alert variant={pauseIdracOperations ? "destructive" : "default"}>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {pauseIdracOperations ? (
                    <span className="font-semibold">⚠️ KILL SWITCH ACTIVE - All iDRAC operations are paused</span>
                  ) : (
                    "iDRAC operations are running normally"
                  )}
                </AlertDescription>
              </Alert>

              <Card>
                <CardHeader>
                  <CardTitle>Emergency Kill Switch</CardTitle>
                  <CardDescription>
                    Immediately halt all iDRAC API calls across the entire platform
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Pause All iDRAC Operations</p>
                      <p className="text-sm text-muted-foreground">
                        Jobs will remain pending until operations are resumed
                      </p>
                    </div>
                    <Switch
                      checked={pauseIdracOperations}
                      onCheckedChange={setPauseIdracOperations}
                    />
                  </div>
                  <Button onClick={handleSaveSettings} disabled={loading}>
                    {loading ? "Saving..." : "Save Safety Settings"}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>iDRAC Throttling Controls</CardTitle>
                  <CardDescription>
                    Limit concurrent operations to prevent overwhelming your infrastructure
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Discovery Max Threads</Label>
                    <Input
                      type="number"
                      value={discoveryMaxThreads}
                      onChange={(e) => setDiscoveryMaxThreads(parseInt(e.target.value) || 5)}
                      min={1}
                      max={20}
                    />
                    <p className="text-sm text-muted-foreground">
                      Maximum concurrent server scans during discovery (1-20)
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Request Delay (ms)</Label>
                    <Input
                      type="number"
                      value={idracRequestDelayMs}
                      onChange={(e) => setIdracRequestDelayMs(parseInt(e.target.value) || 0)}
                      min={0}
                      max={5000}
                    />
                    <p className="text-sm text-muted-foreground">
                      Delay between sequential iDRAC requests (0-5000ms)
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Max Concurrent iDRAC Operations</Label>
                    <Input
                      type="number"
                      value={idracMaxConcurrent}
                      onChange={(e) => setIdracMaxConcurrent(parseInt(e.target.value) || 4)}
                      min={1}
                      max={20}
                    />
                    <p className="text-sm text-muted-foreground">
                      Maximum simultaneous iDRAC operations (1-20)
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </SettingsSection>
        </TabsContent>

        {/* NOTIFICATIONS TAB */}
        <TabsContent value="notifications" className="space-y-4">
          {/* Alert Preferences */}
          <SettingsSection
            id="alert-preferences"
            title="Alert Preferences"
            description="Configure which events trigger notifications"
            icon={Bell}
            defaultOpen={defaultOpenSection === 'alert-preferences'}
          >
            <Card>
              <CardContent className="space-y-4 pt-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Notify on Job Completion</Label>
                    <p className="text-sm text-muted-foreground">
                      Send notification when jobs complete successfully
                    </p>
                  </div>
                  <Switch
                    checked={notifyOnJobComplete}
                    onCheckedChange={setNotifyOnJobComplete}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Notify on Job Failure</Label>
                    <p className="text-sm text-muted-foreground">
                      Send notification when jobs fail
                    </p>
                  </div>
                  <Switch
                    checked={notifyOnJobFailed}
                    onCheckedChange={setNotifyOnJobFailed}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Notify on Job Start</Label>
                    <p className="text-sm text-muted-foreground">
                      Send notification when jobs begin execution
                    </p>
                  </div>
                  <Switch
                    checked={notifyOnJobStarted}
                    onCheckedChange={setNotifyOnJobStarted}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Notify on Cluster Warning</Label>
                    <p className="text-sm text-muted-foreground">
                      Alert when clusters have warnings
                    </p>
                  </div>
                  <Switch
                    checked={notifyOnClusterWarning}
                    onCheckedChange={setNotifyOnClusterWarning}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Notify on Unsafe Cluster</Label>
                    <p className="text-sm text-muted-foreground">
                      Alert when clusters become unsafe for maintenance
                    </p>
                  </div>
                  <Switch
                    checked={notifyOnUnsafeCluster}
                    onCheckedChange={setNotifyOnUnsafeCluster}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Notify on Cluster Status Change</Label>
                    <p className="text-sm text-muted-foreground">
                      Alert when cluster safety status changes
                    </p>
                  </div>
                  <Switch
                    checked={notifyOnClusterStatusChange}
                    onCheckedChange={setNotifyOnClusterStatusChange}
                  />
                </div>

                <Button onClick={handleSaveSettings} disabled={loading}>
                  {loading ? "Saving..." : "Save Alert Preferences"}
                </Button>
              </CardContent>
            </Card>
          </SettingsSection>

          {/* SMTP Email */}
          <SettingsSection
            id="smtp"
            title="Email (SMTP)"
            description="Configure SMTP server for email notifications"
            icon={Mail}
            defaultOpen={defaultOpenSection === 'smtp'}
          >
            <Card>
              <CardContent className="space-y-4 pt-6">
                <div className="space-y-2">
                  <Label htmlFor="smtp-host">SMTP Host</Label>
                  <Input
                    id="smtp-host"
                    placeholder="smtp.example.com"
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="smtp-port">SMTP Port</Label>
                  <Input
                    id="smtp-port"
                    type="number"
                    placeholder="587"
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(parseInt(e.target.value) || 587)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="smtp-user">SMTP Username</Label>
                  <Input
                    id="smtp-user"
                    placeholder="user@example.com"
                    value={smtpUser}
                    onChange={(e) => setSmtpUser(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="smtp-password">SMTP Password</Label>
                  <Input
                    id="smtp-password"
                    type="password"
                    placeholder="••••••••"
                    value={smtpPassword}
                    onChange={(e) => setSmtpPassword(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="smtp-from">From Email Address</Label>
                  <Input
                    id="smtp-from"
                    type="email"
                    placeholder="notifications@example.com"
                    value={smtpFromEmail}
                    onChange={(e) => setSmtpFromEmail(e.target.value)}
                  />
                </div>

                <Button onClick={handleSaveSettings} disabled={loading}>
                  {loading ? "Saving..." : "Save SMTP Settings"}
                </Button>
              </CardContent>
            </Card>
          </SettingsSection>

          {/* Microsoft Teams */}
          <SettingsSection
            id="teams"
            title="Microsoft Teams"
            description="Configure Teams webhook for notifications with @mentions"
            icon={MessageSquare}
            defaultOpen={defaultOpenSection === 'teams'}
          >
            <Card>
              <CardContent className="space-y-4 pt-6">
                <div className="space-y-2">
                  <Label htmlFor="teams-webhook">Teams Webhook URL</Label>
                  <Input
                    id="teams-webhook"
                    placeholder="https://outlook.office.com/webhook/..."
                    value={teamsWebhookUrl}
                    onChange={(e) => setTeamsWebhookUrl(e.target.value)}
                  />
                  <p className="text-sm text-muted-foreground">
                    Create an Incoming Webhook in your Teams channel to get this URL
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="teams-mention-users">Users to @Mention on Critical Failures</Label>
                  <Input
                    id="teams-mention-users"
                    type="text"
                    placeholder="user@company.com, ops-team@company.com"
                    value={teamsMentionUsers}
                    onChange={(e) => setTeamsMentionUsers(e.target.value)}
                  />
                  <p className="text-sm text-muted-foreground">
                    Comma-separated email addresses or UPNs. These users will be @mentioned in Teams for critical failures.
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>@Mention on Critical Failures</Label>
                    <p className="text-sm text-muted-foreground">
                      Notify mentioned users when critical jobs fail
                    </p>
                  </div>
                  <Switch
                    checked={mentionOnCriticalFailures}
                    onCheckedChange={setMentionOnCriticalFailures}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Critical Job Types</Label>
                  <p className="text-sm text-muted-foreground mb-2">
                    Failed jobs of these types will be marked as critical and trigger @mentions
                  </p>
                  <div className="space-y-2">
                    {[
                      { value: 'firmware_update', label: 'Firmware Update' },
                      { value: 'discovery_scan', label: 'Discovery Scan' },
                      { value: 'vcenter_sync', label: 'vCenter Sync' },
                      { value: 'full_server_update', label: 'Full Server Update' }
                    ].map((type) => (
                      <div key={type.value} className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id={`critical-${type.value}`}
                          checked={criticalJobTypes.includes(type.value)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setCriticalJobTypes([...criticalJobTypes, type.value]);
                            } else {
                              setCriticalJobTypes(criticalJobTypes.filter(t => t !== type.value));
                            }
                          }}
                          className="h-4 w-4 rounded border-input"
                        />
                        <Label htmlFor={`critical-${type.value}`} className="text-sm font-normal cursor-pointer">
                          {type.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button onClick={handleSaveSettings} disabled={loading}>
                    {loading ? "Saving..." : "Save Teams Settings"}
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={handleTestTeamsNotification} 
                    disabled={testingTeams || !teamsWebhookUrl}
                  >
                    {testingTeams ? "Sending..." : "Send Test Notification"}
                  </Button>
                </div>

                {recentNotifications.length > 0 && (
                  <div className="mt-6 space-y-3">
                    <Label className="text-base">Recent Notification Deliveries</Label>
                    <div className="rounded-md border">
                      <div className="divide-y">
                        {recentNotifications.slice(0, 5).map((log) => (
                          <div key={log.id} className="flex items-center justify-between p-3">
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                "h-2 w-2 rounded-full",
                                log.status === 'success' ? "bg-green-500" : "bg-destructive"
                              )} />
                              <div>
                                <p className="text-sm font-medium">
                                  {log.notification_type === 'teams' ? 'Teams' : 'Email'} 
                                  {log.is_test && ' (Test)'}
                                  {log.severity && log.severity !== 'normal' && (
                                    <span className={cn(
                                      "ml-2 text-xs font-bold px-2 py-0.5 rounded",
                                      log.severity === 'critical' ? "bg-red-600 text-white" : "bg-orange-600 text-white"
                                    )}>
                                      {log.severity.toUpperCase()}
                                    </span>
                                  )}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {new Date(log.created_at).toLocaleString()}
                                </p>
                              </div>
                            </div>
                            <div className="text-sm">
                              {log.status === 'success' ? (
                                <span className="text-green-600">Delivered</span>
                              ) : (
                                <span className="text-destructive" title={log.error_message}>
                                  Failed
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </SettingsSection>
        </TabsContent>

        {/* INFRASTRUCTURE TAB */}
        <TabsContent value="infrastructure" className="space-y-4">
          {/* Server Groups */}
          <SettingsSection
            id="server-groups"
            title="Server Groups"
            description="Organize servers into logical groups for batch operations"
            icon={Server}
            defaultOpen={defaultOpenSection === 'server-groups'}
          >
            <ServerGroupsManagement />
          </SettingsSection>

          {/* Virtual Media & Backup */}
          <SettingsSection
            id="virtual-media"
            title="Virtual Media & Backup"
            description="ISO image library and SCP share configuration for backups"
            icon={Disc}
            defaultOpen={defaultOpenSection === 'virtual-media'}
          >
            <div className="space-y-6">
              {/* ISO Image Library */}
              <div>
                <h4 className="text-sm font-semibold mb-2">ISO Image Library</h4>
                <p className="text-sm text-muted-foreground mb-4">
                  Manage ISO images for virtual media mounting
                </p>
                <IsoImageLibrary />
              </div>

              {/* SCP Share Settings */}
              <Card>
                <CardHeader>
                  <CardTitle>SCP Share Configuration</CardTitle>
                  <CardDescription>
                    Network share for server configuration profile (SCP) backups (required for older iDRAC firmware)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Enable SCP Share</Label>
                      <p className="text-sm text-muted-foreground">
                        Required for iDRAC firmware older than 4.40 (uses network share instead of HTTP)
                      </p>
                    </div>
                    <Switch
                      checked={scpShareEnabled}
                      onCheckedChange={setScpShareEnabled}
                    />
                  </div>

                  {scpShareEnabled && (
                    <div className="space-y-4 pt-4 border-t">
                      <div className="space-y-2">
                        <Label>Share Type</Label>
                        <Select value={scpShareType} onValueChange={(value: 'CIFS' | 'NFS') => setScpShareType(value)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="CIFS">CIFS/SMB (Windows Share)</SelectItem>
                            <SelectItem value="NFS">NFS (Unix Share)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Share Path</Label>
                        <Input
                          placeholder={scpShareType === 'CIFS' ? "\\\\server\\share" : "server:/export/scp"}
                          value={scpSharePath}
                          onChange={(e) => setScpSharePath(e.target.value)}
                        />
                      </div>

                      {scpShareType === 'CIFS' && (
                        <>
                          <div className="space-y-2">
                            <Label>Username</Label>
                            <Input
                              value={scpShareUsername}
                              onChange={(e) => setScpShareUsername(e.target.value)}
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>Password</Label>
                            <Input
                              type="password"
                              value={scpSharePassword}
                              onChange={(e) => setScpSharePassword(e.target.value)}
                            />
                          </div>
                        </>
                      )}

                      <Button onClick={handleSaveSettings} disabled={loading}>
                        {loading ? "Saving..." : "Save SCP Share Settings"}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </SettingsSection>

          {/* Firmware Library */}
          <SettingsSection
            id="firmware"
            title="Firmware Library"
            description="Manage firmware packages for Dell servers"
            icon={Briefcase}
            defaultOpen={defaultOpenSection === 'firmware'}
          >
            <FirmwareLibrary />
          </SettingsSection>

          {/* OpenManage Enterprise */}
          <SettingsSection
            id="openmanage"
            title="OpenManage Enterprise"
            description="Sync server inventory and firmware from OpenManage Enterprise"
            icon={CloudCog}
            defaultOpen={defaultOpenSection === 'openmanage'}
          >
            <Card>
              <CardContent className="space-y-4 pt-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Enable OME Sync</Label>
                    <p className="text-sm text-muted-foreground">
                      Automatically sync server data from OpenManage Enterprise
                    </p>
                  </div>
                  <Switch
                    checked={omeSyncEnabled}
                    onCheckedChange={setOmeSyncEnabled}
                  />
                </div>

                <div className="space-y-2">
                  <Label>OME Host</Label>
                  <Input
                    placeholder="openmanage.company.com"
                    value={omeHost}
                    onChange={(e) => setOmeHost(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>OME Port</Label>
                  <Input
                    type="number"
                    value={omePort}
                    onChange={(e) => setOmePort(parseInt(e.target.value) || 443)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Username</Label>
                  <Input
                    value={omeUsername}
                    onChange={(e) => setOmeUsername(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Password</Label>
                  <Input
                    type="password"
                    value={omePassword}
                    onChange={(e) => setOmePassword(e.target.value)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Label>Verify SSL Certificate</Label>
                  <Switch
                    checked={omeVerifySSL}
                    onCheckedChange={setOmeVerifySSL}
                  />
                </div>

                {omeLastSync && (
                  <p className="text-sm text-muted-foreground">
                    Last sync: {new Date(omeLastSync).toLocaleString()}
                  </p>
                )}

                <div className="flex gap-2">
                  <Button onClick={handleSaveOmeSettings} disabled={loading}>
                    {loading ? "Saving..." : "Save OME Settings"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleSyncNow}
                    disabled={omeSyncing || !omeSyncEnabled}
                  >
                    {omeSyncing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Sync Now
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </SettingsSection>
        </TabsContent>

        {/* SYSTEM & MONITORING TAB */}
        <TabsContent value="system" className="space-y-4">
          {/* Network Connectivity */}
          <SettingsSection
            id="network"
            title="Network Connectivity"
            description="Test connectivity and configure network timeouts"
            icon={Network}
            defaultOpen={defaultOpenSection === 'network'}
          >
            <div className="space-y-6">
              {/* Network Testing */}
              <Card>
                <CardHeader>
                  <CardTitle>Network Testing</CardTitle>
                  <CardDescription>
                    Test connectivity to iDRAC servers and vCenter
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {servers.length > 0 ? (
                    <>
                      <div className="flex justify-between items-center">
                        <p className="text-sm text-muted-foreground">
                          Test all {servers.length} configured servers
                        </p>
                        <Button
                          onClick={testAllServers}
                          disabled={testingAllServers}
                        >
                          {testingAllServers ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Testing...
                            </>
                          ) : (
                            'Test All Servers'
                          )}
                        </Button>
                      </div>

                      <ScrollArea className="h-[300px] rounded-md border p-4">
                        <div className="space-y-2">
                          {servers.map((server) => {
                            const result = serverTestResults.get(server.id);
                            const testing = testingServers.get(server.id);
                            
                            return (
                              <div key={server.id} className="flex items-center justify-between p-2 rounded hover:bg-accent">
                                <div className="flex items-center gap-3">
                                  <div className={cn(
                                    "h-2 w-2 rounded-full",
                                    testing ? "bg-yellow-500 animate-pulse" :
                                    result?.success ? "bg-green-500" :
                                    result?.error ? "bg-destructive" :
                                    "bg-muted"
                                  )} />
                                  <div>
                                    <p className="text-sm font-medium">
                                      {server.hostname || server.ip_address}
                                    </p>
                                    {result && (
                                      <p className="text-xs text-muted-foreground">
                                        {result.success 
                                          ? `Online (${result.response_time_ms}ms)${result.version ? ` - ${result.version}` : ''}`
                                          : result.error
                                        }
                                      </p>
                                    )}
                                  </div>
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => testIdracServer(server.id)}
                                  disabled={testing}
                                >
                                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Test'}
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No servers configured yet
                    </p>
                  )}

                  {vcenterSettings && (
                    <div className="pt-4 border-t">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">vCenter Server</p>
                          <p className="text-sm text-muted-foreground">
                            {vcenterSettings.host}
                          </p>
                          {vcenterTestResult && (
                            <p className="text-xs text-muted-foreground">
                              {vcenterTestResult.success 
                                ? `Online (${vcenterTestResult.response_time_ms}ms)`
                                : vcenterTestResult.error
                              }
                            </p>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={testVCenterConnection}
                          disabled={testingVCenter}
                        >
                          {testingVCenter ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Test vCenter'}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Job Executor Diagnostics */}
              <Card>
                <CardHeader>
                  <CardTitle>Job Executor Status</CardTitle>
                  <CardDescription>
                    Monitor Job Executor service health and configuration
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <JobExecutorDiagnostics />
                </CardContent>
              </Card>

              {/* Network Settings */}
              <Card>
                <CardHeader>
                  <CardTitle>Network Timeouts & Retry</CardTitle>
                  <CardDescription>
                    Configure connection timeouts and retry behavior
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Connection Timeout (seconds)</Label>
                      <Input
                        type="number"
                        value={connectionTimeout}
                        onChange={(e) => setConnectionTimeout(parseInt(e.target.value) || 30)}
                        min={5}
                        max={300}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Read Timeout (seconds)</Label>
                      <Input
                        type="number"
                        value={readTimeout}
                        onChange={(e) => setReadTimeout(parseInt(e.target.value) || 60)}
                        min={10}
                        max={600}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Max Retry Attempts</Label>
                      <Input
                        type="number"
                        value={maxRetryAttempts}
                        onChange={(e) => setMaxRetryAttempts(parseInt(e.target.value) || 3)}
                        min={0}
                        max={10}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Retry Backoff</Label>
                      <Select value={retryBackoffType} onValueChange={(v: any) => setRetryBackoffType(v)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="exponential">Exponential</SelectItem>
                          <SelectItem value="linear">Linear</SelectItem>
                          <SelectItem value="fixed">Fixed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <Button onClick={handleSaveNetworkSettings} disabled={loading}>
                    {loading ? "Saving..." : "Save Network Settings"}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </SettingsSection>

          {/* Cluster Monitoring */}
          <SettingsSection
            id="cluster-monitoring"
            title="Cluster Monitoring"
            description="Scheduled safety checks for vSphere clusters"
            icon={Activity}
            defaultOpen={defaultOpenSection === 'cluster-monitoring'}
          >
            <Card>
              <CardContent className="space-y-4 pt-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Enable Scheduled Checks</Label>
                    <p className="text-sm text-muted-foreground">
                      Automatically run cluster safety checks on a schedule
                    </p>
                  </div>
                  <Switch
                    checked={scheduledChecksEnabled}
                    onCheckedChange={setScheduledChecksEnabled}
                  />
                </div>

                {scheduledChecksEnabled && (
                  <div className="space-y-4 pt-4 border-t">
                    <div className="space-y-2">
                      <Label>Check Frequency (Cron Expression)</Label>
                      <Input
                        placeholder="0 */6 * * *"
                        value={checkFrequency}
                        onChange={(e) => setCheckFrequency(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Examples: "0 */6 * * *" (every 6 hours), "0 0 * * *" (daily at midnight)
                      </p>
                    </div>

                    <div className="flex items-center justify-between">
                      <Label>Check All Clusters</Label>
                      <Switch
                        checked={checkAllClusters}
                        onCheckedChange={setCheckAllClusters}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Minimum Required Hosts</Label>
                      <Input
                        type="number"
                        value={minRequiredHosts}
                        onChange={(e) => setMinRequiredHosts(parseInt(e.target.value) || 2)}
                        min={1}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <Label>Notify on Unsafe Cluster</Label>
                      <Switch
                        checked={notifyOnUnsafeCluster}
                        onCheckedChange={setNotifyOnUnsafeCluster}
                      />
                    </div>

                    {lastScheduledCheck && (
                      <Alert>
                        <Info className="h-4 w-4" />
                        <AlertDescription>
                          Last check: {new Date(lastScheduledCheck.last_run_at).toLocaleString()} - {lastScheduledCheck.last_status}
                        </AlertDescription>
                      </Alert>
                    )}

                    <div className="flex gap-2">
                      <Button onClick={saveScheduledCheckConfig} disabled={loading}>
                        {loading ? "Saving..." : "Save Schedule"}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={runScheduledChecksNow}
                        disabled={runningScheduledCheck}
                      >
                        {runningScheduledCheck ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Running...
                          </>
                        ) : (
                          'Run Check Now'
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </SettingsSection>

          {/* Activity Monitor */}
          <SettingsSection
            id="activity"
            title="Activity Monitor"
            description="Configure activity log retention and monitoring"
            icon={Terminal}
            defaultOpen={defaultOpenSection === 'activity'}
          >
            <Card>
              <CardContent className="space-y-4 pt-6">
                <div className="space-y-2">
                  <Label>Log Retention (days)</Label>
                  <Input
                    type="number"
                    value={logRetentionDays}
                    onChange={(e) => setLogRetentionDays(parseInt(e.target.value) || 30)}
                    min={1}
                    max={365}
                  />
                  <p className="text-sm text-muted-foreground">
                    Activity logs older than this will be automatically deleted
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Auto-Cleanup</Label>
                    <p className="text-sm text-muted-foreground">
                      Automatically delete old logs
                    </p>
                  </div>
                  <Switch
                    checked={autoCleanupEnabled}
                    onCheckedChange={setAutoCleanupEnabled}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Log Level</Label>
                  <Select value={logLevel} onValueChange={(v: any) => setLogLevel(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All API Calls</SelectItem>
                      <SelectItem value="errors_only">Errors Only</SelectItem>
                      <SelectItem value="slow_only">Slow Requests Only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Slow Command Threshold (ms)</Label>
                  <Input
                    type="number"
                    value={slowCommandThreshold}
                    onChange={(e) => setSlowCommandThreshold(parseInt(e.target.value) || 5000)}
                    min={1000}
                  />
                </div>

                {lastCleanupAt && (
                  <p className="text-sm text-muted-foreground">
                    Last cleanup: {new Date(lastCleanupAt).toLocaleString()}
                  </p>
                )}

                <div className="flex gap-2">
                  <Button onClick={handleSaveSettings} disabled={loading}>
                    {loading ? "Saving..." : "Save Activity Settings"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleCleanupNow}
                    disabled={cleaningUp}
                  >
                    {cleaningUp ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Cleaning...
                      </>
                    ) : (
                      'Cleanup Now'
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </SettingsSection>

          {/* Jobs Configuration */}
          <SettingsSection
            id="jobs"
            title="Jobs Configuration"
            description="Manage job retention and stale job handling"
            icon={Database}
            defaultOpen={defaultOpenSection === 'jobs'}
          >
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Job Retention</CardTitle>
                  <CardDescription>
                    Configure how long completed jobs are kept
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Retention Period (days)</Label>
                    <Input
                      type="number"
                      value={jobRetentionDays}
                      onChange={(e) => setJobRetentionDays(parseInt(e.target.value) || 90)}
                      min={1}
                      max={365}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Auto-Cleanup</Label>
                      <p className="text-sm text-muted-foreground">
                        Automatically delete old jobs
                      </p>
                    </div>
                    <Switch
                      checked={jobAutoCleanupEnabled}
                      onCheckedChange={setJobAutoCleanupEnabled}
                    />
                  </div>

                  {jobLastCleanupAt && (
                    <p className="text-sm text-muted-foreground">
                      Last cleanup: {new Date(jobLastCleanupAt).toLocaleString()}
                    </p>
                  )}

                  <div className="flex gap-2">
                    <Button onClick={handleSaveSettings} disabled={loading}>
                      {loading ? "Saving..." : "Save Job Settings"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleJobCleanupNow}
                      disabled={jobCleaningUp}
                    >
                      {jobCleaningUp ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Cleaning...
                        </>
                      ) : (
                        'Cleanup Now'
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Stale Job Management</CardTitle>
                  <CardDescription>
                    Handle jobs stuck in pending or running state
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Stale Pending Threshold (hours)</Label>
                    <Input
                      type="number"
                      value={stalePendingHours}
                      onChange={(e) => setStalePendingHours(parseInt(e.target.value) || 24)}
                      min={1}
                    />
                    <p className="text-sm text-muted-foreground">
                      Jobs pending longer than this are considered stale
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Stale Running Threshold (hours)</Label>
                    <Input
                      type="number"
                      value={staleRunningHours}
                      onChange={(e) => setStaleRunningHours(parseInt(e.target.value) || 48)}
                      min={1}
                    />
                    <p className="text-sm text-muted-foreground">
                      Jobs running longer than this are considered stale
                    </p>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Auto-Cancel Stale Jobs</Label>
                      <p className="text-sm text-muted-foreground">
                        Automatically cancel jobs that exceed thresholds
                      </p>
                    </div>
                    <Switch
                      checked={autoCancelStaleJobs}
                      onCheckedChange={setAutoCancelStaleJobs}
                    />
                  </div>

                  {staleJobCount > 0 && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        {staleJobCount} stale job(s) detected
                      </AlertDescription>
                    </Alert>
                  )}

                  <Button onClick={handleSaveSettings} disabled={loading}>
                    {loading ? "Saving..." : "Save Stale Job Settings"}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </SettingsSection>
        </TabsContent>

      </Tabs>

      <DiagnosticsDialog 
        open={showDiagnosticsDialog}
        onOpenChange={setShowDiagnosticsDialog}
      />
    </div>
  );
}