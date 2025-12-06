/**
 * Zerfaux - ZFS-backed DR Orchestration for vSphere
 * 
 * Main replication page with panels for:
 * - vCenter connections and sync
 * - VM inventory
 * - Protection groups and protected VMs
 * - Replication jobs
 */

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Database, 
  Server, 
  Shield, 
  Activity, 
  Target,
  AlertTriangle,
  Info
} from "lucide-react";
import { VCenterPanel } from "@/components/replication/VCenterPanel";
import { ProtectionGroupsPanel } from "@/components/replication/ProtectionGroupsPanel";
import { ReplicationTargetsPanel } from "@/components/replication/ReplicationTargetsPanel";
import { ReplicationJobsPanel } from "@/components/replication/ReplicationJobsPanel";
import { ReplicationStatsBar } from "@/components/replication/ReplicationStatsBar";
import { useProtectionGroups, useReplicationTargets, useReplicationJobs } from "@/hooks/useReplication";

export default function Replication() {
  const [activeTab, setActiveTab] = useState("protection-groups");
  
  const { groups, loading: groupsLoading } = useProtectionGroups();
  const { targets, loading: targetsLoading } = useReplicationTargets();
  const { jobs, loading: jobsLoading } = useReplicationJobs();
  
  // Calculate stats
  const totalProtectedVMs = groups.reduce((sum, g) => sum + (g.vm_count || 0), 0);
  const activeTargets = targets.filter(t => t.is_active && t.health_status === 'healthy').length;
  const runningJobs = jobs.filter(j => j.status === 'running').length;
  const recentFailures = jobs.filter(j => j.status === 'failed').slice(0, 5).length;

  return (
    <div className="flex-1 space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Database className="h-6 w-6 text-primary" />
            Zerfaux DR Orchestration
          </h1>
          <p className="text-muted-foreground">
            ZFS-backed disaster recovery for VMware vSphere
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Stub Mode
          </Badge>
        </div>
      </div>
      
      {/* Stub Mode Alert */}
      <Alert className="border-amber-500/30 bg-amber-500/5">
        <Info className="h-4 w-4 text-amber-600" />
        <AlertDescription className="text-amber-700 dark:text-amber-400">
          Zerfaux is running in <strong>stub mode</strong>. All vCenter and ZFS operations are simulated. 
          See PLAN_ZERFAUX.md for real implementation roadmap.
        </AlertDescription>
      </Alert>
      
      {/* Stats Bar */}
      <ReplicationStatsBar 
        protectionGroupsCount={groups.length}
        protectedVMsCount={totalProtectedVMs}
        activeTargetsCount={activeTargets}
        totalTargetsCount={targets.length}
        runningJobsCount={runningJobs}
        recentFailuresCount={recentFailures}
        loading={groupsLoading || targetsLoading || jobsLoading}
      />
      
      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
          <TabsTrigger value="protection-groups" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            <span className="hidden sm:inline">Protection</span>
          </TabsTrigger>
          <TabsTrigger value="vcenters" className="flex items-center gap-2">
            <Server className="h-4 w-4" />
            <span className="hidden sm:inline">vCenters</span>
          </TabsTrigger>
          <TabsTrigger value="targets" className="flex items-center gap-2">
            <Target className="h-4 w-4" />
            <span className="hidden sm:inline">Targets</span>
          </TabsTrigger>
          <TabsTrigger value="jobs" className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            <span className="hidden sm:inline">Jobs</span>
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="protection-groups" className="space-y-4">
          <ProtectionGroupsPanel />
        </TabsContent>
        
        <TabsContent value="vcenters" className="space-y-4">
          <VCenterPanel />
        </TabsContent>
        
        <TabsContent value="targets" className="space-y-4">
          <ReplicationTargetsPanel />
        </TabsContent>
        
        <TabsContent value="jobs" className="space-y-4">
          <ReplicationJobsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
