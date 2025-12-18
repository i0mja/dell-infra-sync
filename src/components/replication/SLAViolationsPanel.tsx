import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, AlertCircle, CheckCircle, RefreshCw, Shield, ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { SLADiagnosisDialog } from "./SLADiagnosisDialog";

interface SLAViolation {
  id: string;
  protection_group_id: string;
  violation_type: string;
  severity: string;
  details: {
    group_name?: string;
    current_rpo_minutes?: number;
    target_rpo_minutes?: number;
    reminder_days?: number;
    last_test_at?: string;
  };
  created_at: string;
  resolved_at: string | null;
  notification_sent: boolean;
}

interface ProtectionGroup {
  id: string;
  name: string;
}

export function SLAViolationsPanel() {
  const [showResolved, setShowResolved] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  // Fetch violations
  const { data: violations, isLoading, refetch } = useQuery({
    queryKey: ["sla-violations", showResolved],
    queryFn: async () => {
      let query = supabase
        .from("sla_violations")
        .select("*")
        .order("created_at", { ascending: false });
      
      if (!showResolved) {
        query = query.is("resolved_at", null);
      }
      
      const { data, error } = await query.limit(50);
      if (error) throw error;
      return data as SLAViolation[];
    },
    refetchInterval: 30000,
  });

  // Fetch protection groups for names
  const { data: groups } = useQuery({
    queryKey: ["protection-groups-minimal"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("protection_groups")
        .select("id, name");
      if (error) throw error;
      return data as ProtectionGroup[];
    },
  });

  const getGroupName = (groupId: string, details: SLAViolation["details"]) => {
    return details?.group_name || groups?.find(g => g.id === groupId)?.name || "Unknown Group";
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case "critical":
        return <Badge variant="destructive">Critical</Badge>;
      case "warning":
        return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/30">Warning</Badge>;
      default:
        return <Badge variant="secondary">{severity}</Badge>;
    }
  };

  const getViolationIcon = (type: string) => {
    switch (type) {
      case "rpo_breach":
        return <AlertTriangle className="h-4 w-4 text-destructive" />;
      case "test_overdue":
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      default:
        return <Shield className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getViolationDescription = (violation: SLAViolation) => {
    switch (violation.violation_type) {
      case "rpo_breach":
        const current = violation.details?.current_rpo_minutes || 0;
        const target = violation.details?.target_rpo_minutes || 60;
        return `Current RPO: ${current} min (target: ${target} min)`;
      case "test_overdue":
        const days = violation.details?.reminder_days || 30;
        return `Failover test overdue (reminder: ${days} days)`;
      default:
        return violation.violation_type.replace(/_/g, " ");
    }
  };

  const activeViolations = violations?.filter(v => !v.resolved_at) || [];

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                SLA Violations
                {activeViolations.length > 0 && (
                  <Badge variant="destructive" className="ml-2">
                    {activeViolations.length} Active
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Track and manage SLA compliance issues across protection groups
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowResolved(!showResolved)}
              >
                {showResolved ? "Hide Resolved" : "Show Resolved"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading violations...</div>
          ) : violations?.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-3" />
              <p className="text-muted-foreground">
                {showResolved 
                  ? "No SLA violations recorded" 
                  : "All protection groups are meeting their SLA targets"}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]"></TableHead>
                  <TableHead>Protection Group</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Detected</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {violations?.map((violation) => (
                  <TableRow 
                    key={violation.id}
                    className={cn(
                      violation.resolved_at 
                        ? "opacity-60" 
                        : "cursor-pointer hover:bg-muted/50 transition-colors"
                    )}
                    onClick={() => !violation.resolved_at && setSelectedGroupId(violation.protection_group_id)}
                  >
                    <TableCell>{getViolationIcon(violation.violation_type)}</TableCell>
                    <TableCell className="font-medium">
                      {getGroupName(violation.protection_group_id, violation.details)}
                    </TableCell>
                    <TableCell className="capitalize">
                      {violation.violation_type.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell>{getSeverityBadge(violation.severity)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[300px] truncate">
                      {getViolationDescription(violation)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDistanceToNow(new Date(violation.created_at), { addSuffix: true })}
                    </TableCell>
                    <TableCell>
                      {violation.resolved_at ? (
                        <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">
                          Resolved
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/30">
                          Active
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {!violation.resolved_at && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedGroupId(violation.protection_group_id);
                          }}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* SLA Diagnosis Dialog */}
      <SLADiagnosisDialog
        open={!!selectedGroupId}
        onOpenChange={(open) => !open && setSelectedGroupId(null)}
        protectionGroupId={selectedGroupId || ''}
      />
    </>
  );
}
