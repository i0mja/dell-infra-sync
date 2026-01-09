import { 
  AlertTriangle, 
  XCircle, 
  WifiOff, 
  Key, 
  ChevronDown, 
  ChevronUp,
  ExternalLink,
  Check,
  RotateCcw,
  HardDrive,
  MemoryStick
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
import { formatDellPartNumber } from "@/lib/drive-utils";

const INTERNAL_JOB_TYPES = [
  'idm_authenticate', 'idm_test_auth', 'idm_test_connection',
  'idm_network_check', 'idm_test_ad_connection', 'idm_search_groups',
  'idm_search_ad_groups', 'idm_search_ad_users', 'idm_sync_users',
];

interface ComponentFault {
  type: 'drive' | 'memory';
  slot: string;
  partNumber: string | null;
  partNumberInferred?: boolean; // True if P/N was looked up from another drive with same model
  model?: string;
  mediaType?: string;
  manufacturer?: string;
  severity: 'critical' | 'warning';
  message: string;
}

interface AlertItem {
  id: string;
  label: string;
  sublabel?: string;
  location?: string;
  components?: ComponentFault[];
}

interface AlertCategory {
  id: string;
  icon: React.ElementType;
  title: string;
  severity: 'critical' | 'warning' | 'info';
  count: number;
  items: AlertItem[];
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

  // Query for servers with hardware faults (drives, memory) - with full component details
  const { data: hardwareFaults } = useQuery({
    queryKey: ['hardware-faults-alerts'],
    queryFn: async () => {
      // Get servers with critical/failed drives - include component details
      const { data: driveIssues } = await supabase
        .from('server_drives')
        .select(`
          server_id, slot, health, status, predicted_failure,
          part_number, model, serial_number, media_type,
          servers!inner(id, hostname, ip_address, datacenter, rack_id, rack_position)
        `)
        .or('health.eq.Critical,status.eq.Disabled,status.eq.UnavailableOffline,predicted_failure.eq.true');

      // Get servers with critical memory - include component details
      const { data: memoryIssues } = await supabase
        .from('server_memory')
        .select(`
          server_id, slot_name, health, part_number, serial_number, manufacturer,
          servers!inner(id, hostname, ip_address, datacenter, rack_id, rack_position)
        `)
        .eq('health', 'Critical');

      // Build a model -> part_number lookup from healthy drives for fallback
      const { data: modelPartNumbers } = await supabase
        .from('server_drives')
        .select('model, part_number')
        .not('model', 'is', null)
        .not('part_number', 'is', null)
        .neq('health', 'Critical');

      const modelToPartNumber: Record<string, string> = {};
      modelPartNumbers?.forEach(d => {
        if (d.model && d.part_number && !modelToPartNumber[d.model]) {
          modelToPartNumber[d.model] = d.part_number;
        }
      });

      // Aggregate by server with component details
      const serverIssues: Record<string, { 
        serverId: string; 
        hostname: string; 
        ipAddress: string;
        location: string;
        components: ComponentFault[];
      }> = {};

      const buildLocation = (server: { datacenter?: string | null; rack_id?: string | null; rack_position?: string | null }) => {
        const parts: string[] = [];
        if (server.datacenter) parts.push(server.datacenter);
        if (server.rack_id) parts.push(server.rack_id);
        // rack_position already includes 'U' prefix (e.g., "U31-U32")
        if (server.rack_position) parts.push(server.rack_position);
        return parts.join(' · ');
      };

      driveIssues?.forEach(d => {
        const server = d.servers as unknown as { 
          id: string; hostname: string; ip_address: string;
          datacenter: string | null; rack_id: string | null; rack_position: string | null;
        };
        if (!serverIssues[server.id]) {
          serverIssues[server.id] = { 
            serverId: server.id, 
            hostname: server.hostname || server.ip_address || 'Unknown',
            ipAddress: server.ip_address || '',
            location: buildLocation(server),
            components: []
          };
        }
        
        const isCritical = d.health === 'Critical' || d.status === 'Disabled' || d.status === 'UnavailableOffline';
        const message = d.predicted_failure && !isCritical 
          ? 'Predictive failure' 
          : d.health === 'Critical' ? 'Critical' : d.status || 'Failed';
        
        // Use direct part_number if available, otherwise look up from matching model
        const directPartNumber = d.part_number;
        const inferredPartNumber = !directPartNumber && d.model ? modelToPartNumber[d.model] : null;
        const partNumber = directPartNumber || inferredPartNumber;
        
        serverIssues[server.id].components.push({
          type: 'drive',
          slot: d.slot ? `Bay ${d.slot}` : 'Unknown bay',
          partNumber,
          partNumberInferred: !directPartNumber && !!inferredPartNumber,
          model: d.model,
          mediaType: d.media_type === 'SSD' ? 'SSD' : d.media_type === 'HDD' ? 'HDD' : undefined,
          severity: isCritical ? 'critical' : 'warning',
          message
        });
      });

      memoryIssues?.forEach(m => {
        const server = m.servers as unknown as { 
          id: string; hostname: string; ip_address: string;
          datacenter: string | null; rack_id: string | null; rack_position: string | null;
        };
        if (!serverIssues[server.id]) {
          serverIssues[server.id] = { 
            serverId: server.id, 
            hostname: server.hostname || server.ip_address || 'Unknown',
            ipAddress: server.ip_address || '',
            location: buildLocation(server),
            components: []
          };
        }
        
        serverIssues[server.id].components.push({
          type: 'memory',
          slot: m.slot_name || 'Unknown slot',
          partNumber: m.part_number,
          manufacturer: m.manufacturer,
          severity: 'critical',
          message: 'Critical'
        });
      });

      return Object.values(serverIssues);
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

  if (hardwareFaults && hardwareFaults.length > 0) {
    const totalComponents = hardwareFaults.reduce((sum, f) => sum + f.components.length, 0);
    categories.push({
      id: 'hardware',
      icon: HardDrive,
      title: 'Hardware Faults',
      severity: 'critical',
      count: totalComponents,
      items: hardwareFaults.map(f => {
        const driveCount = f.components.filter(c => c.type === 'drive').length;
        const memoryCount = f.components.filter(c => c.type === 'memory').length;
        const parts: string[] = [];
        if (driveCount > 0) parts.push(`${driveCount} drive${driveCount > 1 ? 's' : ''}`);
        if (memoryCount > 0) parts.push(`${memoryCount} DIMM${memoryCount > 1 ? 's' : ''}`);
        return {
          id: f.serverId,
          label: f.hostname,
          sublabel: parts.join(', '),
          location: f.location,
          components: f.components
        };
      }),
      actionLabel: 'View Affected Servers',
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
                        <div className="grid gap-1 max-h-48 overflow-y-auto">
                          {category.items.slice(0, 5).map(item => (
                            <div key={item.id} className="py-1.5">
                              {/* Server header with hostname */}
                              <div className="text-xs text-muted-foreground flex items-center gap-2">
                                <span className="h-1 w-1 rounded-full bg-muted-foreground" />
                                <Link 
                                  to={`/servers?server=${item.id}`} 
                                  className="font-medium text-foreground hover:underline"
                                >
                                  {item.label}
                                </Link>
                                {item.sublabel && !item.components && (
                                  <span className="text-muted-foreground/60">{item.sublabel}</span>
                                )}
                              </div>
                              
                              {/* Location line for hardware faults */}
                              {item.location && (
                                <div className="ml-3 text-[10px] text-muted-foreground/70 mt-0.5">
                                  {item.location}
                                </div>
                              )}
                              
                              {/* Component details for hardware faults */}
                              {item.components && item.components.length > 0 && (
                                <div className="ml-3 mt-1 space-y-0.5">
                                  {item.components.map((comp, idx) => (
                                    <div 
                                      key={idx} 
                                      className="text-[10px] flex items-center gap-1.5 text-muted-foreground"
                                    >
                                      <span className={cn(
                                        "h-1.5 w-1.5 rounded-full flex-shrink-0",
                                        comp.severity === 'critical' ? "bg-destructive" : "bg-amber-500"
                                      )} />
                                      {comp.type === 'drive' ? (
                                        <HardDrive className="h-3 w-3 flex-shrink-0" />
                                      ) : (
                                        <MemoryStick className="h-3 w-3 flex-shrink-0" />
                                      )}
                                      <span className="font-medium">{comp.slot}</span>
                                      {comp.mediaType && (
                                        <span className="text-muted-foreground/70">{comp.mediaType}</span>
                                      )}
                                      {comp.partNumber && (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <span 
                                              className="font-mono text-[9px] bg-muted px-1 rounded cursor-help" 
                                            >
                                              P/N: {formatDellPartNumber(comp.partNumber)}{comp.partNumberInferred ? '*' : ''}
                                            </span>
                                          </TooltipTrigger>
                                          <TooltipContent side="top" className="text-xs">
                                            {comp.partNumberInferred 
                                              ? `Inferred from model ${comp.model}` 
                                              : comp.partNumber}
                                          </TooltipContent>
                                        </Tooltip>
                                      )}
                                      {comp.type === 'memory' && comp.manufacturer && !comp.partNumber && (
                                        <span className="font-mono text-[9px] bg-muted px-1 rounded">
                                          {comp.manufacturer}
                                        </span>
                                      )}
                                      <span className={cn(
                                        "ml-auto",
                                        comp.severity === 'critical' ? "text-destructive" : "text-amber-600"
                                      )}>
                                        {comp.message}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                          {category.items.length > 5 && (
                            <div className="text-xs text-muted-foreground py-1">
                              +{category.items.length - 5} more servers
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
