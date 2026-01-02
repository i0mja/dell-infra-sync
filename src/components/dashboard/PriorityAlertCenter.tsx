import { 
  AlertTriangle, 
  XCircle, 
  WifiOff, 
  Key, 
  ChevronDown, 
  ChevronUp,
  ExternalLink,
  Check,
  RotateCcw
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
import { useAlertAcknowledgment } from "@/hooks/useAlertAcknowledgment";
import { useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);
  const [showAcknowledged, setShowAcknowledged] = useState(false);
  const { acknowledge, isAcknowledged, unacknowledge, clearAll } = useAlertAcknowledgment();

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

  // Separate active from acknowledged categories
  const activeCategories = categories.filter(c => !isAcknowledged(c.id, c.count));
  const acknowledgedCategories = categories.filter(c => isAcknowledged(c.id, c.count));

  // If no categories at all, return null
  if (categories.length === 0) return null;

  // If all acknowledged and not showing them, show minimal bar
  if (activeCategories.length === 0 && acknowledgedCategories.length > 0 && !showAcknowledged) {
    return (
      <div className="rounded-lg border bg-muted/30 p-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Check className="h-4 w-4 text-green-500" />
          <span>{acknowledgedCategories.length} acknowledged issue{acknowledgedCategories.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAcknowledged(true)}
            className="text-xs"
          >
            Show Details
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={clearAll}
                className="h-7 w-7"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reset all acknowledgments</TooltipContent>
          </Tooltip>
        </div>
      </div>
    );
  }

  const toggleCategory = (id: string) => {
    setExpandedCategories(prev => 
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const displayCategories = showAcknowledged ? categories : activeCategories;
  const totalAlerts = displayCategories.reduce((sum, cat) => sum + cat.count, 0);
  const hasCritical = displayCategories.some(c => c.severity === 'critical');

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
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">Attention Required</h3>
                {acknowledgedCategories.length > 0 && !showAcknowledged && (
                  <Badge variant="outline" className="text-xs">
                    +{acknowledgedCategories.length} acknowledged
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {totalAlerts} issue{totalAlerts !== 1 ? 's' : ''} need{totalAlerts === 1 ? 's' : ''} your attention
              </p>
            </div>
          </div>

          {/* Alert Categories */}
          <div className="space-y-2">
            {displayCategories.map(category => {
              const acked = isAcknowledged(category.id, category.count);
              return (
                <Collapsible
                  key={category.id}
                  open={expandedCategories.includes(category.id)}
                  onOpenChange={() => toggleCategory(category.id)}
                >
                  <div className={cn(
                    "rounded-lg border overflow-hidden",
                    acked ? "bg-muted/30 opacity-60" : "bg-card/50"
                  )}>
                    <div className="flex items-center">
                      <CollapsibleTrigger asChild>
                        <button className="flex items-center justify-between flex-1 p-3 hover:bg-muted/50 transition-colors text-left">
                          <div className="flex items-center gap-3">
                            <category.icon className={cn(
                              "h-4 w-4",
                              acked ? "text-muted-foreground" :
                              category.severity === 'critical' ? "text-destructive" : "text-amber-500"
                            )} />
                            <span className={cn("font-medium text-sm", acked && "text-muted-foreground")}>
                              {category.title}
                            </span>
                            <Badge className={cn(
                              "text-xs",
                              acked ? "bg-muted text-muted-foreground" : severityBadgeColors[category.severity]
                            )}>
                              {category.count}
                            </Badge>
                            {acked && (
                              <Badge variant="outline" className="text-xs text-green-600 border-green-600/30">
                                Acknowledged
                              </Badge>
                            )}
                          </div>
                          {expandedCategories.includes(category.id) 
                            ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> 
                            : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          }
                        </button>
                      </CollapsibleTrigger>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (acked) {
                                unacknowledge(category.id);
                              } else {
                                acknowledge(category.id, category.count);
                              }
                            }}
                            className="h-8 w-8 mr-2"
                          >
                            {acked ? (
                              <RotateCcw className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <Check className="h-4 w-4 text-muted-foreground hover:text-green-500" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {acked ? "Unacknowledge" : "Acknowledge (hide until count changes)"}
                        </TooltipContent>
                      </Tooltip>
                    </div>
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
              );
            })}
          </div>

          {/* Show/Hide Acknowledged Toggle */}
          {acknowledgedCategories.length > 0 && (
            <div className="flex items-center justify-between pt-2 border-t">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAcknowledged(!showAcknowledged)}
                className="text-xs text-muted-foreground"
              >
                {showAcknowledged ? "Hide Acknowledged" : `Show ${acknowledgedCategories.length} Acknowledged`}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                className="text-xs text-muted-foreground"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Reset All
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
