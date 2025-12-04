import { AlertCircle, WifiOff, XCircle, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Link } from "react-router-dom";

const INTERNAL_JOB_TYPES = [
  'idm_authenticate',
  'idm_test_auth',
  'idm_test_connection',
  'idm_network_check',
  'idm_test_ad_connection',
  'idm_search_groups',
  'idm_search_ad_groups',
  'idm_search_ad_users',
  'idm_sync_users',
];

export const IssuesBanner = () => {
  const [dismissed, setDismissed] = useState(false);

  const { data: offlineServers } = useQuery({
    queryKey: ['offline-servers-dashboard'],
    queryFn: async () => {
      const { data } = await supabase
        .from('servers')
        .select('id, hostname, ip_address')
        .eq('connection_status', 'offline')
        .limit(5);
      return data || [];
    }
  });

  const { data: failedJobs } = useQuery({
    queryKey: ['failed-jobs-24h'],
    queryFn: async () => {
      const { data } = await supabase
        .from('jobs')
        .select('id, job_type, created_at')
        .eq('status', 'failed')
        .is('parent_job_id', null)
        .not('job_type', 'in', `(${INTERNAL_JOB_TYPES.join(',')})`)
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(5);
      return data || [];
    }
  });

  const { data: missingCredentials } = useQuery({
    queryKey: ['missing-credentials-count'],
    queryFn: async () => {
      const { data } = await supabase
        .from('servers')
        .select('id')
        .is('credential_set_id', null);
      return data?.length || 0;
    }
  });

  const hasOfflineServers = (offlineServers?.length || 0) > 0;
  const hasFailedJobs = (failedJobs?.length || 0) > 0;
  const hasMissingCredentials = (missingCredentials || 0) > 0;
  const hasIssues = hasOfflineServers || hasFailedJobs || hasMissingCredentials;

  if (!hasIssues || dismissed) return null;

  return (
    <div className="border-l-4 border-amber-500 bg-amber-500/5 p-4 rounded-lg">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            <h3 className="font-semibold text-amber-600 dark:text-amber-400">Attention Required</h3>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {hasOfflineServers && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <WifiOff className="h-4 w-4 text-destructive" />
                  Unreachable Servers ({offlineServers?.length})
                </div>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  {offlineServers?.slice(0, 2).map(server => (
                    <div key={server.id}>
                      {server.hostname || server.ip_address}
                    </div>
                  ))}
                  {(offlineServers?.length || 0) > 2 && (
                    <div>+{(offlineServers?.length || 0) - 2} more</div>
                  )}
                </div>
              </div>
            )}

            {hasFailedJobs && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <XCircle className="h-4 w-4 text-destructive" />
                  Failed Jobs (24h): {failedJobs?.length}
                </div>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  {failedJobs?.slice(0, 2).map(job => (
                    <div key={job.id}>
                      {job.job_type.replace(/_/g, ' ')}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {hasMissingCredentials && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  Missing Credentials
                </div>
                <div className="text-xs text-muted-foreground">
                  {missingCredentials} servers without credentials
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            {hasOfflineServers && (
              <Button asChild variant="outline" size="sm">
                <Link to="/servers?status=offline">View Offline Servers</Link>
              </Button>
            )}
            {hasFailedJobs && (
              <Button asChild variant="outline" size="sm">
                <Link to="/activity?status=failed">View Failed Jobs</Link>
              </Button>
            )}
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDismissed(true)}
          className="shrink-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};
