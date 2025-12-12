/**
 * CopyTemplateCrossVCenterDialog
 * 
 * Dialog for copying ZFS target templates between vCenters using direct
 * ESXi-to-ESXi transfer (vim.ServiceLocator) for efficiency.
 */

import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Copy,
  Server,
  Database,
  ChevronDown,
  Terminal,
  Zap,
} from "lucide-react";
import { useVCenters } from "@/hooks/useVCenters";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface CopyTemplateCrossVCenterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceVCenterId: string;
  sourceVCenterName: string;
  sourceTemplateMoref: string;
  sourceTemplateName: string;
  templateSettings?: {
    name?: string;
    description?: string;
    default_zfs_pool_name?: string;
    default_zfs_disk_path?: string;
    default_nfs_network?: string;
    default_cpu_count?: number;
    default_memory_gb?: number;
    default_zfs_disk_gb?: number;
    default_ssh_username?: string;
  };
  onSuccess?: () => void;
}

interface VCenterDatastore {
  name: string;
  freeSpaceGB: number;
}

interface VCenterCluster {
  name: string;
}

export function CopyTemplateCrossVCenterDialog({
  open,
  onOpenChange,
  sourceVCenterId,
  sourceVCenterName,
  sourceTemplateMoref,
  sourceTemplateName,
  templateSettings,
  onSuccess,
}: CopyTemplateCrossVCenterDialogProps) {
  const { toast } = useToast();
  const { vcenters } = useVCenters();
  
  // Form state
  const [destVCenterId, setDestVCenterId] = useState("");
  const [destDatastore, setDestDatastore] = useState("");
  const [destCluster, setDestCluster] = useState("");
  const [newTemplateName, setNewTemplateName] = useState("");
  
  // Resource loading
  const [loadingResources, setLoadingResources] = useState(false);
  const [datastores, setDatastores] = useState<VCenterDatastore[]>([]);
  const [clusters, setClusters] = useState<VCenterCluster[]>([]);
  
  // Job state
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState("");
  const [jobProgress, setJobProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const [consoleLog, setConsoleLog] = useState<string[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(true);
  
  // Filter out source vCenter
  const destinationVCenters = useMemo(
    () => vcenters.filter(vc => vc.id !== sourceVCenterId),
    [vcenters, sourceVCenterId]
  );
  
  // Find selected destination vCenter
  const selectedDestVC = useMemo(
    () => vcenters.find(vc => vc.id === destVCenterId),
    [vcenters, destVCenterId]
  );
  
  // Reset on open
  useEffect(() => {
    if (open) {
      setDestVCenterId("");
      setDestDatastore("");
      setDestCluster("");
      setNewTemplateName(sourceTemplateName);
      setJobId(null);
      setJobStatus("");
      setJobProgress(0);
      setCurrentStep("");
      setConsoleLog([]);
      setDatastores([]);
      setClusters([]);
    }
  }, [open, sourceTemplateName]);
  
  // Fetch destination vCenter resources
  useEffect(() => {
    if (!destVCenterId) {
      setDatastores([]);
      setClusters([]);
      return;
    }
    
    const fetchResources = async () => {
      setLoadingResources(true);
      try {
        // Get clusters from vcenter_hosts
        const { data: hosts } = await supabase
          .from('vcenter_hosts')
          .select('cluster')
          .eq('vcenter_id', destVCenterId)
          .not('cluster', 'is', null);
        
        const uniqueClusters = [...new Set(hosts?.map(h => h.cluster).filter(Boolean) || [])];
        setClusters(uniqueClusters.map(name => ({ name: name as string })));
        
        // Get datastores from vcenter_datastores
        const { data: ds } = await supabase
          .from('vcenter_datastores')
          .select('name, free_bytes')
          .eq('vcenter_id', destVCenterId);
        
        setDatastores(ds?.map(d => ({
          name: d.name,
          freeSpaceGB: (d.free_bytes || 0) / 1024 / 1024 / 1024
        })) || []);
        
      } catch (err) {
        console.error('Failed to fetch resources:', err);
      } finally {
        setLoadingResources(false);
      }
    };
    
    fetchResources();
  }, [destVCenterId]);
  
  // Start copy job
  const handleStartCopy = async () => {
    if (!destVCenterId || !destDatastore || !newTemplateName) {
      toast({ title: 'Please fill all required fields', variant: 'destructive' });
      return;
    }
    
    try {
      const { data: user } = await supabase.auth.getUser();
      
      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'copy_template_cross_vcenter' as const,
          status: 'pending',
          created_by: user?.user?.id,
          details: {
            source_vcenter_id: sourceVCenterId,
            source_template_moref: sourceTemplateMoref,
            source_template_name: sourceTemplateName,
            dest_vcenter_id: destVCenterId,
            dest_cluster: destCluster || undefined,
            dest_datastore: destDatastore,
            new_template_name: newTemplateName,
            create_db_entry: true,
            template_settings: {
              ...templateSettings,
              name: `${newTemplateName} Template`,
            },
          }
        })
        .select()
        .single();
      
      if (error) throw error;
      
      setJobId(job.id);
      toast({ title: 'Template copy started', description: 'Direct ESXi-to-ESXi transfer in progress...' });
      
      // Poll for completion
      let attempts = 0;
      const pollInterval = setInterval(async () => {
        attempts++;
        const { data: jobResult } = await supabase
          .from('jobs')
          .select('status, details')
          .eq('id', job.id)
          .single();
        
        setJobStatus(jobResult?.status || '');
        const details = jobResult?.details as Record<string, unknown> | null;
        
        if (details?.progress_percent) {
          setJobProgress(details.progress_percent as number);
        }
        if (details?.current_step) {
          setCurrentStep(details.current_step as string);
        }
        if (details?.console_log && Array.isArray(details.console_log)) {
          setConsoleLog(details.console_log as string[]);
        }
        
        if (jobResult?.status === 'completed') {
          clearInterval(pollInterval);
          setJobProgress(100);
          toast({ title: 'Template copied successfully!' });
          onSuccess?.();
        } else if (jobResult?.status === 'failed') {
          clearInterval(pollInterval);
          toast({
            title: 'Template copy failed',
            description: details?.error as string || 'Unknown error',
            variant: 'destructive'
          });
        } else if (attempts >= 180) { // 6 minute timeout
          clearInterval(pollInterval);
          toast({
            title: 'Template copy timeout',
            description: 'Job is taking longer than expected. Check job status.',
            variant: 'destructive'
          });
        }
      }, 2000);
    } catch (err) {
      toast({
        title: 'Failed to start copy',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive'
      });
    }
  };
  
  const isJobRunning = jobStatus === 'running' || jobStatus === 'pending';
  const isJobComplete = jobStatus === 'completed';
  const canStart = destVCenterId && destDatastore && newTemplateName && !jobId;
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-5 w-5" />
            Copy Template to Another Site
          </DialogTitle>
          <DialogDescription>
            Direct ESXi-to-ESXi transfer using VMware ServiceLocator
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          {/* Source info */}
          <div className="p-3 rounded-lg bg-muted/50 space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Server className="h-4 w-4" />
              Source Template
            </h4>
            <div className="text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">vCenter:</span>
                <span>{sourceVCenterName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Template:</span>
                <span className="font-mono text-xs">{sourceTemplateName}</span>
              </div>
            </div>
          </div>
          
          {/* Transfer method info */}
          <Alert className="py-2">
            <Zap className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Uses direct vCenter-to-vCenter clone when both are in the same SSO domain.
              Otherwise falls back to OVF export/import (slower).
            </AlertDescription>
          </Alert>
          
          {/* Destination selection */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Destination vCenter</Label>
              <Select 
                value={destVCenterId} 
                onValueChange={setDestVCenterId}
                disabled={!!jobId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select destination site..." />
                </SelectTrigger>
                <SelectContent>
                  {destinationVCenters.map((vc) => (
                    <SelectItem key={vc.id} value={vc.id}>
                      {vc.name} ({vc.host})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {destVCenterId && (
              <>
                <div className="space-y-2">
                  <Label>Destination Datastore *</Label>
                  <Select
                    value={destDatastore}
                    onValueChange={setDestDatastore}
                    disabled={!!jobId || loadingResources}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={loadingResources ? "Loading..." : "Select datastore..."} />
                    </SelectTrigger>
                    <SelectContent>
                      {datastores.map((ds) => (
                        <SelectItem key={ds.name} value={ds.name}>
                          <div className="flex items-center gap-2">
                            <Database className="h-3 w-3" />
                            <span>{ds.name}</span>
                            <Badge variant="outline" className="text-xs ml-2">
                              {ds.freeSpaceGB.toFixed(0)} GB free
                            </Badge>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label>Destination Cluster (optional)</Label>
                  <Select
                    value={destCluster}
                    onValueChange={setDestCluster}
                    disabled={!!jobId || loadingResources}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Auto-detect cluster..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Auto-detect</SelectItem>
                      {clusters.map((cl) => (
                        <SelectItem key={cl.name} value={cl.name}>
                          {cl.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label>New Template Name</Label>
                  <Input
                    value={newTemplateName}
                    onChange={(e) => setNewTemplateName(e.target.value)}
                    placeholder="e.g., zfs-appliance-template"
                    disabled={!!jobId}
                  />
                </div>
              </>
            )}
          </div>
          
          {/* Job progress */}
          {jobId && (
            <div className="space-y-3 p-4 rounded-lg border">
              <div className="flex items-center gap-2">
                {isJobRunning ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : isJobComplete ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-destructive" />
                )}
                <span className="font-medium text-sm">
                  {isJobRunning ? currentStep || 'Starting copy...' :
                   isJobComplete ? 'Template copied successfully!' :
                   'Copy failed'}
                </span>
              </div>
              
              {isJobRunning && (
                <div className="space-y-1">
                  <Progress value={jobProgress} className="h-2" />
                  <p className="text-xs text-muted-foreground text-right">{jobProgress}%</p>
                </div>
              )}
              
              {/* Console log */}
              {consoleLog.length > 0 && (
                <Collapsible open={consoleOpen} onOpenChange={setConsoleOpen}>
                  <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                    <Terminal className="h-3 w-3" />
                    Console Log ({consoleLog.length} lines)
                    <ChevronDown className={`h-3 w-3 transition-transform ${consoleOpen ? 'rotate-180' : ''}`} />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <ScrollArea className="h-32 mt-2 rounded bg-zinc-950 p-2">
                      <div className="font-mono text-xs text-green-400 space-y-0.5">
                        {consoleLog.map((line, i) => (
                          <div key={i} className="whitespace-pre-wrap">{line}</div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          )}
        </div>
        
        <DialogFooter className="border-t pt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {isJobComplete ? 'Close' : 'Cancel'}
          </Button>
          {!jobId && (
            <Button onClick={handleStartCopy} disabled={!canStart}>
              <Copy className="h-4 w-4 mr-2" />
              Start Copy
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
