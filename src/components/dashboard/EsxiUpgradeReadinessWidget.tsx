import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UploadCloud, CheckCircle2, AlertCircle, PlayCircle } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";

export const EsxiUpgradeReadinessWidget = () => {
  const queryClient = useQueryClient();
  const [selectedProfile, setSelectedProfile] = useState<string>("");

  const { data: hosts, isLoading: hostsLoading } = useQuery({
    queryKey: ['vcenter-hosts-version'],
    queryFn: async () => {
      const { data } = await supabase
        .from('vcenter_hosts')
        .select('id, name, esxi_version, status, maintenance_mode');
      return data || [];
    }
  });

  const { data: profiles } = useQuery({
    queryKey: ['esxi-profiles'],
    queryFn: async () => {
      const { data } = await supabase
        .from('esxi_upgrade_profiles')
        .select('*')
        .eq('is_active', true);
      return data || [];
    }
  });

  const { data: history } = useQuery({
    queryKey: ['recent-upgrades'],
    queryFn: async () => {
      const { data } = await supabase
        .from('esxi_upgrade_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);
      return data || [];
    }
  });

  const healthyHosts = hosts?.filter(h => 
    (h.status === 'green' || h.status === 'Connected') && !h.maintenance_mode
  ) || [];

  const eligibleForUpgrade = healthyHosts.filter(h => 
    h.esxi_version && profiles?.some(p => 
      !p.min_source_version || h.esxi_version! >= p.min_source_version
    )
  );

  const recentSuccessful = history?.filter(h => h.status === 'completed').length || 0;
  const recentFailed = history?.filter(h => h.status === 'failed').length || 0;

  const runPreflightCheck = useMutation({
    mutationFn: async () => {
      if (!selectedProfile) {
        throw new Error("Please select an upgrade profile");
      }
      if (eligibleForUpgrade.length === 0) {
        throw new Error("No eligible hosts found");
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const hostIds = eligibleForUpgrade.map(h => h.id);

      const { error } = await supabase.from('jobs').insert({
        job_type: 'esxi_preflight_check',
        created_by: user.id,
        status: 'pending',
        details: {
          profile_id: selectedProfile,
          host_ids: hostIds
        }
      });

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pre-flight check started");
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to start pre-flight check: ${error.message}`);
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UploadCloud className="h-5 w-5 text-primary" />
          ESXi Upgrade Readiness
        </CardTitle>
        <CardDescription>
          Hosts eligible for ESXi upgrades
        </CardDescription>
      </CardHeader>
      <CardContent>
        {hostsLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="text-sm text-muted-foreground">Total Hosts</div>
                <div className="text-2xl font-bold">{hosts?.length || 0}</div>
              </div>
              <div className="p-3 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded-lg">
                <div className="text-sm text-muted-foreground">Ready</div>
                <div className="text-2xl font-bold">{eligibleForUpgrade.length}</div>
              </div>
            </div>

            <div className="p-3 bg-muted/50 rounded-lg space-y-2">
              <div className="text-sm font-medium">Upgrade Profiles Available</div>
              <div className="text-2xl font-bold">{profiles?.length || 0}</div>
              {profiles && profiles.length > 0 && (
                <div className="space-y-1">
                  {profiles.slice(0, 2).map(profile => (
                    <Badge key={profile.id} variant="secondary" className="text-xs">
                      {profile.target_version}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {history && history.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium">Recent Upgrade Activity</div>
                <div className="flex gap-2">
                  <div className="flex items-center gap-1 text-sm">
                    <CheckCircle2 className="h-3 w-3 text-green-600" />
                    <span>{recentSuccessful} successful</span>
                  </div>
                  <div className="flex items-center gap-1 text-sm">
                    <AlertCircle className="h-3 w-3 text-destructive" />
                    <span>{recentFailed} failed</span>
                  </div>
                </div>
              </div>
            )}

            {profiles && profiles.length > 0 && eligibleForUpgrade.length > 0 && (
              <div className="space-y-2 p-3 border border-border/50 rounded-lg bg-muted/20">
                <div className="text-sm font-medium">Pre-flight Check</div>
                <Select value={selectedProfile} onValueChange={setSelectedProfile}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select profile..." />
                  </SelectTrigger>
                  <SelectContent>
                    {profiles.map(profile => (
                      <SelectItem key={profile.id} value={profile.id}>
                        {profile.name} ({profile.target_version})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button 
                  onClick={() => runPreflightCheck.mutate()} 
                  disabled={!selectedProfile || runPreflightCheck.isPending}
                  size="sm"
                  className="w-full"
                >
                  <PlayCircle className="w-4 h-4 mr-2" />
                  {runPreflightCheck.isPending ? "Running..." : "Run Pre-flight Check"}
                </Button>
              </div>
            )}

            <Button asChild variant="outline" className="w-full" size="sm">
              <Link to="/vcenter">Manage ESXi Upgrades</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
