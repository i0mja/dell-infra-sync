import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UploadCloud, CheckCircle2, AlertCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

export const EsxiUpgradeReadinessWidget = () => {
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

            <Button asChild variant="outline" className="w-full" size="sm">
              <Link to="/vcenter">Manage ESXi Upgrades</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
