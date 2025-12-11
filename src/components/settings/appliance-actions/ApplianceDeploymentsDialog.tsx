import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ZfsTargetTemplate } from "@/hooks/useZfsTemplates";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { Server, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Deployment {
  id: string;
  name: string;
  hostname?: string;
  health_status?: string;
  created_at: string;
}

interface ApplianceDeploymentsDialogProps {
  template: ZfsTargetTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ApplianceDeploymentsDialog = ({
  template,
  open,
  onOpenChange,
}: ApplianceDeploymentsDialogProps) => {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && template) {
      fetchDeployments();
    }
  }, [open, template]);

  const fetchDeployments = async () => {
    if (!template) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("replication_targets")
        .select("id, name, hostname, health_status, created_at")
        .eq("source_template_id", template.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setDeployments(data || []);
    } catch (err) {
      console.error("Error fetching deployments:", err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (health_status?: string) => {
    switch (health_status) {
      case "online":
      case "healthy":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "offline":
      case "error":
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Deployments from {template?.name}
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[400px]">
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">
              Loading deployments...
            </div>
          ) : deployments.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <Server className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No deployments yet</p>
              <p className="text-xs">
                ZFS targets deployed from this template will appear here
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {deployments.map((deployment) => (
                <div
                  key={deployment.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    {getStatusIcon(deployment.health_status)}
                    <div>
                      <div className="font-medium text-sm">{deployment.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {deployment.hostname || "No hostname"}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge variant="outline" className="text-xs">
                      {deployment.health_status || "unknown"}
                    </Badge>
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatDistanceToNow(new Date(deployment.created_at), {
                        addSuffix: true,
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
