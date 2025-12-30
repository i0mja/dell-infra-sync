import { useState } from "react";
import { 
  AlertTriangle, 
  XCircle, 
  WifiOff, 
  Key, 
  ChevronDown, 
  ChevronUp,
  ExternalLink,
  X 
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const INTERNAL_JOB_TYPES = [
  'idm_authenticate', 'idm_test_auth', 'idm_test_connection',
  'idm_network_check', 'idm_test_ad_connection', 'idm_search_groups',
  'idm_search_ad_groups', 'idm_search_ad_users', 'idm_sync_users',
];

interface AlertCategory {
  id: string;
  icon: React.ElementType;
  title: string;
  severity: 'critical' | 'warning' | 'info';
  count: number;
  items: Array<{ id: string; label: string; sublabel?: string }>;
  actionLabel: string;
  actionLink: string;
}

export const PriorityAlertCenter = () => {
  const [dismissed, setDismissed] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);

  const { data: offlineServers } = useQuery({
    queryKey: ['offline-servers-alerts'],
    queryFn: async () => {
      const { data } = await supabase
        .from('servers')
        .select('id, hostname, ip_address')
        .eq('connection_status', 'offline')
        .limit(10);
      return data || [];
    }
  });

  const { data: failedJobs } = useQuery({
    queryKey: ['failed-jobs-alerts'],
    queryFn: async () => {
      const { data } = await supabase
        .from('jobs')
        .select('id, job_type, created_at, details')
        .eq('status', 'failed')
        .is('parent_job_id', null)
        .not('job_type', 'in', `(${INTERNAL_JOB_TYPES.join(',')})`)
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(10);
      return data || [];
    }
  });

  const { data: missingCredentials } = useQuery({
    queryKey: ['missing-credentials-alerts'],
    queryFn: async () => {
      const { data } = await supabase
        .from('servers')
        .select('id, hostname, ip_address')
        .is('credential_set_id', null)
        .limit(10);
      return data || [];
    }
  });

  const categories: AlertCategory[] = [];

  if (offlineServers && offlineServers.length > 0) {
    categories.push({
      id: 'offline',
      icon: WifiOff,
      title: 'Unreachable Servers',
      severity: 'critical',
      count: offlineServers.length,
      items: offlineServers.map(s => ({
        id: s.id,
        label: s.hostname || s.ip_address || 'Unknown',
        sublabel: s.ip_address
      })),
      actionLabel: 'View Offline Servers',
      actionLink: '/servers?status=offline'
    });
  }

  if (failedJobs && failedJobs.length > 0) {
    categories.push({
      id: 'failed',
      icon: XCircle,
      title: 'Failed Jobs (24h)',
      severity: 'critical',
      count: failedJobs.length,
      items: failedJobs.map(j => ({
        id: j.id,
        label: j.job_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      })),
      actionLabel: 'View Failed Jobs',
      actionLink: '/activity?status=failed'
    });
  }

  if (missingCredentials && missingCredentials.length > 0) {
    categories.push({
      id: 'credentials',
      icon: Key,
      title: 'Missing Credentials',
      severity: 'warning',
      count: missingCredentials.length,
      items: missingCredentials.map(s => ({
        id: s.id,
        label: s.hostname || s.ip_address || 'Unknown',
      })),
      actionLabel: 'Configure Credentials',
      actionLink: '/servers'
    });
  }

  if (categories.length === 0 || dismissed) return null;

  const toggleCategory = (id: string) => {
    setExpandedCategories(prev => 
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const totalAlerts = categories.reduce((sum, cat) => sum + cat.count, 0);
  const hasCritical = categories.some(c => c.severity === 'critical');

  const severityColors = {
    critical: 'border-destructive/50 bg-destructive/5',
    warning: 'border-amber-500/50 bg-amber-500/5',
    info: 'border-blue-500/50 bg-blue-500/5',
  };

  const severityBadgeColors = {
    critical: 'bg-destructive text-destructive-foreground',
    warning: 'bg-amber-500 text-white',
    info: 'bg-blue-500 text-white',
  };

  return (
    <div className={cn(
      "rounded-xl border-l-4 p-4",
      hasCritical ? severityColors.critical : severityColors.warning
    )}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-4">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className={cn(
              "p-2 rounded-lg",
              hasCritical ? "bg-destructive/10" : "bg-amber-500/10"
            )}>
              <AlertTriangle className={cn(
                "h-5 w-5",
                hasCritical ? "text-destructive" : "text-amber-500"
              )} />
            </div>
            <div>
              <h3 className="font-semibold">Attention Required</h3>
              <p className="text-sm text-muted-foreground">
                {totalAlerts} issue{totalAlerts !== 1 ? 's' : ''} need{totalAlerts === 1 ? 's' : ''} your attention
              </p>
            </div>
          </div>

          {/* Alert Categories */}
          <div className="space-y-2">
            {categories.map(category => (
              <Collapsible
                key={category.id}
                open={expandedCategories.includes(category.id)}
                onOpenChange={() => toggleCategory(category.id)}
              >
                <div className="rounded-lg border bg-card/50 overflow-hidden">
                  <CollapsibleTrigger asChild>
                    <button className="flex items-center justify-between w-full p-3 hover:bg-muted/50 transition-colors text-left">
                      <div className="flex items-center gap-3">
                        <category.icon className={cn(
                          "h-4 w-4",
                          category.severity === 'critical' ? "text-destructive" : "text-amber-500"
                        )} />
                        <span className="font-medium text-sm">{category.title}</span>
                        <Badge className={cn("text-xs", severityBadgeColors[category.severity])}>
                          {category.count}
                        </Badge>
                      </div>
                      {expandedCategories.includes(category.id) 
                        ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> 
                        : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      }
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-3 pb-3 space-y-2">
                      <div className="grid gap-1 max-h-32 overflow-y-auto">
                        {category.items.slice(0, 5).map(item => (
                          <div key={item.id} className="text-xs text-muted-foreground flex items-center gap-2 py-1">
                            <span className="h-1 w-1 rounded-full bg-muted-foreground" />
                            <span className="truncate">{item.label}</span>
                            {item.sublabel && (
                              <span className="text-muted-foreground/60">{item.sublabel}</span>
                            )}
                          </div>
                        ))}
                        {category.items.length > 5 && (
                          <div className="text-xs text-muted-foreground py-1">
                            +{category.items.length - 5} more
                          </div>
                        )}
                      </div>
                      <Button asChild variant="outline" size="sm" className="w-full mt-2">
                        <Link to={category.actionLink}>
                          {category.actionLabel}
                          <ExternalLink className="h-3 w-3 ml-2" />
                        </Link>
                      </Button>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            ))}
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDismissed(true)}
          className="shrink-0 h-8 w-8"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};
