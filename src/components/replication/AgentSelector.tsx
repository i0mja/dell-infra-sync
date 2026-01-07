/**
 * Agent Selector Component
 * 
 * Displays a list of available ZFS agents that can be connected as replication targets.
 * Only shows agents that are online and not already linked to a target.
 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Server, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  RefreshCw,
  Wifi,
  WifiOff,
  HardDrive,
  Clock,
} from "lucide-react";
import { ZfsAgent, useZfsAgents } from "@/hooks/useZfsAgents";
import { formatDistanceToNow } from "date-fns";

interface AgentSelectorProps {
  selectedAgentId: string | undefined;
  onSelect: (agent: ZfsAgent | null) => void;
  disabled?: boolean;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === 0) return "Unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unitIndex = 0;
  let value = bytes;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function getStatusBadge(status: ZfsAgent['status']) {
  switch (status) {
    case 'online':
    case 'idle':
      return (
        <Badge variant="outline" className="text-green-600 border-green-600/30 bg-green-500/10">
          <Wifi className="h-3 w-3 mr-1" />
          Online
        </Badge>
      );
    case 'busy':
      return (
        <Badge variant="outline" className="text-blue-600 border-blue-600/30 bg-blue-500/10">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          Busy
        </Badge>
      );
    case 'offline':
      return (
        <Badge variant="outline" className="text-muted-foreground border-muted-foreground/30">
          <WifiOff className="h-3 w-3 mr-1" />
          Offline
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-muted-foreground">
          Unknown
        </Badge>
      );
  }
}

export function AgentSelector({ selectedAgentId, onSelect, disabled }: AgentSelectorProps) {
  const { agents, isLoading, error, refetch, isAgentOnline } = useZfsAgents();
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<'success' | 'failed' | null>(null);
  
  // Filter to only show unlinked agents (not already assigned to a target)
  const unlinkedAgents = agents.filter(agent => !agent.target_id);
  const onlineUnlinkedAgents = unlinkedAgents.filter(isAgentOnline);
  
  const selectedAgent = agents.find(a => a.id === selectedAgentId);
  
  const handleTestConnection = async () => {
    if (!selectedAgent) return;
    
    setTestingConnection(true);
    setConnectionResult(null);
    
    try {
      const url = `${selectedAgent.api_protocol}://${selectedAgent.hostname}:${selectedAgent.api_port}/v1/health`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
      });
      
      setConnectionResult(response.ok ? 'success' : 'failed');
    } catch {
      setConnectionResult('failed');
    } finally {
      setTestingConnection(false);
    }
  };
  
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading agents...</span>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="flex items-center gap-2 p-4 text-destructive">
        <AlertCircle className="h-4 w-4" />
        <span className="text-sm">Failed to load agents: {error}</span>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
    );
  }
  
  if (unlinkedAgents.length === 0) {
    return (
      <div className="p-4 rounded-lg border border-dashed bg-muted/30 space-y-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm font-medium">No ZFS Agents Available</span>
        </div>
        <p className="text-xs text-muted-foreground">
          ZFS Agents must be installed on your appliances to use this mode. 
          Once installed, agents will register automatically and appear here.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Select 
          value={selectedAgentId || ""} 
          onValueChange={(id) => {
            const agent = agents.find(a => a.id === id) || null;
            onSelect(agent);
            setConnectionResult(null);
          }}
          disabled={disabled}
        >
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Select an agent..." />
          </SelectTrigger>
          <SelectContent>
            {onlineUnlinkedAgents.length > 0 && (
              <>
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  Online Agents
                </div>
                {onlineUnlinkedAgents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    <div className="flex items-center gap-2">
                      <Server className="h-4 w-4 text-green-500" />
                      <span>{agent.hostname}</span>
                      {agent.pool_name && (
                        <span className="text-xs text-muted-foreground">
                          ({agent.pool_name})
                        </span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </>
            )}
            {unlinkedAgents.filter(a => !isAgentOnline(a)).length > 0 && (
              <>
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground border-t mt-1 pt-2">
                  Offline Agents
                </div>
                {unlinkedAgents.filter(a => !isAgentOnline(a)).map((agent) => (
                  <SelectItem key={agent.id} value={agent.id} disabled>
                    <div className="flex items-center gap-2 opacity-50">
                      <Server className="h-4 w-4" />
                      <span>{agent.hostname}</span>
                      <span className="text-xs">(offline)</span>
                    </div>
                  </SelectItem>
                ))}
              </>
            )}
          </SelectContent>
        </Select>
        
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => refetch()}
          disabled={isLoading}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      
      {/* Selected Agent Details */}
      {selectedAgent && (
        <div className="p-4 rounded-lg border bg-card space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-primary" />
              <span className="font-medium">{selectedAgent.hostname}</span>
            </div>
            {getStatusBadge(selectedAgent.status)}
          </div>
          
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">API Endpoint</div>
              <div className="font-mono text-xs">
                {selectedAgent.api_protocol}://{selectedAgent.hostname}:{selectedAgent.api_port}
              </div>
            </div>
            
            {selectedAgent.pool_name && (
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">ZFS Pool</div>
                <div className="flex items-center gap-2">
                  <HardDrive className="h-3 w-3" />
                  <span>{selectedAgent.pool_name}</span>
                  {selectedAgent.pool_health && (
                    <Badge 
                      variant="outline" 
                      className={selectedAgent.pool_health === 'ONLINE' 
                        ? 'text-green-600 border-green-600/30' 
                        : 'text-yellow-600 border-yellow-600/30'
                      }
                    >
                      {selectedAgent.pool_health}
                    </Badge>
                  )}
                </div>
              </div>
            )}
            
            {selectedAgent.pool_size_bytes && (
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Pool Size</div>
                <div>{formatBytes(selectedAgent.pool_size_bytes)}</div>
              </div>
            )}
            
            {selectedAgent.pool_free_bytes && (
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Free Space</div>
                <div>{formatBytes(selectedAgent.pool_free_bytes)}</div>
              </div>
            )}
            
            {selectedAgent.last_seen_at && (
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Last Seen</div>
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDistanceToNow(new Date(selectedAgent.last_seen_at), { addSuffix: true })}
                </div>
              </div>
            )}
            
            {selectedAgent.agent_version && (
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Agent Version</div>
                <div>{selectedAgent.agent_version}</div>
              </div>
            )}
          </div>
          
          {/* Test Connection */}
          <div className="flex items-center gap-2 pt-2 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestConnection}
              disabled={testingConnection || !isAgentOnline(selectedAgent)}
            >
              {testingConnection ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Wifi className="h-4 w-4 mr-2" />
              )}
              Test Connection
            </Button>
            
            {connectionResult === 'success' && (
              <Badge variant="outline" className="text-green-600 border-green-600/30">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Connected
              </Badge>
            )}
            
            {connectionResult === 'failed' && (
              <Badge variant="outline" className="text-destructive border-destructive/30">
                <AlertCircle className="h-3 w-3 mr-1" />
                Connection Failed
              </Badge>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
