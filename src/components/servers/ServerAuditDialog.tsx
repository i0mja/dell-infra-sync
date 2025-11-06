import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ServerAuditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: {
    id: string;
    hostname: string | null;
    ip_address: string;
  };
}

interface AuditLog {
  id: string;
  timestamp: string;
  action: string;
  user_id: string | null;
  details: any;
  profiles?: {
    email: string;
    full_name: string | null;
  };
}

export const ServerAuditDialog = ({ open, onOpenChange, server }: ServerAuditDialogProps) => {
  const [loading, setLoading] = useState(true);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      fetchAuditLogs();
    }
  }, [open]);

  const fetchAuditLogs = async () => {
    try {
      setLoading(true);
      
      // Query audit logs where details contains this server_id
      const { data, error } = await supabase
        .from("audit_logs")
        .select(`
          id,
          timestamp,
          action,
          user_id,
          details,
          profiles:user_id (
            email,
            full_name
          )
        `)
        .or(`details->>server_id.eq.${server.id},details->>server_name.eq.${server.hostname || server.ip_address}`)
        .order("timestamp", { ascending: false })
        .limit(50);

      if (error) throw error;
      setAuditLogs(data || []);
    } catch (error: any) {
      toast({
        title: "Error loading audit logs",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatAction = (action: string) => {
    return action
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const getActionVariant = (action: string): "default" | "secondary" | "destructive" => {
    if (action.includes('delete') || action.includes('remove')) return "destructive";
    if (action.includes('create') || action.includes('add')) return "default";
    return "secondary";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Audit History</DialogTitle>
          <DialogDescription>
            Activity log for {server.hostname || server.ip_address}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[60vh]">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : auditLogs.length === 0 ? (
            <div className="text-center p-8 border rounded-lg">
              <p className="text-muted-foreground">No audit logs found for this server</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm whitespace-nowrap">
                      {formatTimestamp(log.timestamp)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getActionVariant(log.action)}>
                        {formatAction(log.action)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {log.profiles
                        ? log.profiles.full_name || log.profiles.email
                        : "System"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {log.details && typeof log.details === 'object' ? (
                        <div className="space-y-0.5 text-muted-foreground">
                          {Object.entries(log.details)
                            .filter(([key]) => !['server_id', 'server_name'].includes(key))
                            .map(([key, value]) => (
                              <div key={key}>
                                <span className="font-medium">{key}:</span>{" "}
                                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                              </div>
                            ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
