import { useState } from "react";
import { Server } from "@/hooks/useServers";
import { ServerIssueSummary } from "@/hooks/useServerIssueSummaries";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  ChevronDown, 
  ChevronRight, 
  AlertTriangle, 
  AlertCircle,
  HardDrive,
  MemoryStick,
  CornerDownRight
} from "lucide-react";

interface ActiveIssuesSectionProps {
  servers: Server[];
  issueSummaries: Map<string, ServerIssueSummary>;
  selectedServers: Set<string>;
  onServerClick: (server: Server) => void;
  onToggleSelection: (serverId: string) => void;
  selectedServerId: string | null;
}

export function ActiveIssuesSection({
  servers,
  issueSummaries,
  selectedServers,
  onServerClick,
  onToggleSelection,
  selectedServerId,
}: ActiveIssuesSectionProps) {
  const [isOpen, setIsOpen] = useState(true);

  // Get servers with issues
  const serversWithIssues = servers.filter(s => issueSummaries.has(s.id));
  
  if (serversWithIssues.length === 0) {
    return null;
  }

  // Check if any server has critical issues
  const hasCriticalIssues = serversWithIssues.some(s => issueSummaries.get(s.id)?.hasCritical);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="border-b">
      <CollapsibleTrigger asChild>
        <div 
          className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-accent/50 ${
            hasCriticalIssues ? 'bg-destructive/5 border-l-2 border-l-destructive' : 'bg-amber-500/5 border-l-2 border-l-amber-500'
          }`}
        >
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          {hasCriticalIssues ? (
            <AlertCircle className="h-4 w-4 text-destructive" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          )}
          <span className="font-semibold text-sm">Active Issues</span>
          <Badge 
            variant={hasCriticalIssues ? "destructive" : "secondary"}
            className={!hasCriticalIssues ? "bg-amber-500 text-white hover:bg-amber-500/90" : ""}
          >
            {serversWithIssues.length} server{serversWithIssues.length > 1 ? 's' : ''}
          </Badge>
          <span className="text-xs text-muted-foreground ml-2">
            Click to {isOpen ? 'collapse' : 'expand'}
          </span>
        </div>
      </CollapsibleTrigger>
      
      <CollapsibleContent>
        <Table>
          <TableBody>
            {serversWithIssues.map(server => {
              const summary = issueSummaries.get(server.id);
              if (!summary) return null;
              
              return (
                <TableRow 
                  key={`issue-${server.id}`}
                  className={`cursor-pointer ${
                    selectedServerId === server.id ? 'bg-accent' : 
                    summary.hasCritical ? 'bg-destructive/5 hover:bg-destructive/10' : 
                    'bg-amber-500/5 hover:bg-amber-500/10'
                  }`}
                >
                  <TableCell className="w-10 py-2 px-2" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedServers.has(server.id)}
                      onCheckedChange={() => onToggleSelection(server.id)}
                      className="h-3.5 w-3.5"
                    />
                  </TableCell>
                  <TableCell 
                    className="py-2 px-2"
                    onClick={() => onServerClick(server)}
                  >
                    <div className="flex flex-col gap-1">
                      {/* Server info row */}
                      <div className="flex items-center gap-3">
                        <span className="font-medium text-sm">{server.hostname || server.ip_address}</span>
                        <span className="text-xs text-muted-foreground font-mono">{server.ip_address}</span>
                        <Badge 
                          variant={summary.hasCritical ? "destructive" : "secondary"}
                          className={`text-xs ${!summary.hasCritical ? "bg-amber-500 text-white" : ""}`}
                        >
                          {summary.hasCritical ? (
                            <><AlertCircle className="h-3 w-3 mr-1" />Critical</>
                          ) : (
                            <><AlertTriangle className="h-3 w-3 mr-1" />Warning</>
                          )}
                        </Badge>
                      </div>
                      
                      {/* Issue details */}
                      <div className="flex flex-col gap-0.5 ml-4">
                        {summary.issues.map((issue, idx) => (
                          <div 
                            key={idx} 
                            className={`flex items-center gap-2 text-xs ${
                              issue.isCritical ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            <CornerDownRight className="h-3 w-3 text-muted-foreground" />
                            {issue.type === 'drive' ? (
                              <HardDrive className="h-3 w-3" />
                            ) : (
                              <MemoryStick className="h-3 w-3" />
                            )}
                            <span className="font-medium">{issue.slot}:</span>
                            <span>{issue.health}</span>
                            {issue.status && issue.status !== "Enabled" && (
                              <span className="text-muted-foreground">- {issue.status}</span>
                            )}
                            {issue.message && (
                              <span className="text-muted-foreground italic">({issue.message})</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CollapsibleContent>
    </Collapsible>
  );
}
