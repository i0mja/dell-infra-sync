import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Power, Zap, Square, RefreshCw, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { logActivityDirect } from "@/hooks/useActivityLog";

interface PowerControlDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: {
    id: string;
    ip_address: string;
    hostname?: string;
    power_state?: string;
  };
}

export function PowerControlDialog({ open, onOpenChange, server }: PowerControlDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);

  const handlePowerAction = async (action: string) => {
    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'power_action',
          created_by: user.id,
          target_scope: {
            type: 'specific',
            server_ids: [server.id]
          },
          details: { action }
        });

      if (jobError) throw jobError;

      toast.success(`Power action "${action}" initiated`, {
        description: `Job created for ${server.hostname || server.ip_address}`
      });

      // Log activity
      logActivityDirect('power_action', 'server', server.hostname || server.ip_address, { action }, { targetId: server.id, success: true });
      
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error creating power action job:', error);
      toast.error('Failed to initiate power action', {
        description: error.message
      });

      // Log failed activity
      logActivityDirect('power_action', 'server', server.hostname || server.ip_address, { action }, { targetId: server.id, success: false, error: error.message });
    } finally {
      setIsSubmitting(false);
      setConfirmAction(null);
    }
  };

  const destructiveActions = ['ForceOff', 'ForceRestart'];
  const requiresConfirmation = (action: string) => destructiveActions.includes(action);

  const handleActionClick = (action: string) => {
    if (requiresConfirmation(action)) {
      setConfirmAction(action);
    } else {
      handlePowerAction(action);
    }
  };

  const getPowerStateColor = (state?: string) => {
    if (!state) return "secondary";
    return state === "On" ? "default" : "outline";
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Power className="h-5 w-5" />
              Power Control
            </DialogTitle>
            <DialogDescription>
              Execute power actions on {server.hostname || server.ip_address}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Current Power State */}
            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/50">
              <span className="text-sm font-medium">Current Power State:</span>
              <Badge variant={getPowerStateColor(server.power_state)}>
                {server.power_state || 'Unknown'}
              </Badge>
            </div>

            {/* Power Actions */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium mb-3">Power Actions</h4>
              
              <Button
                onClick={() => handleActionClick('On')}
                disabled={isSubmitting}
                className="w-full justify-start"
                variant="outline"
              >
                <Power className="h-4 w-4 mr-2" />
                Power On
              </Button>

              <Button
                onClick={() => handleActionClick('GracefulShutdown')}
                disabled={isSubmitting}
                className="w-full justify-start"
                variant="outline"
              >
                <Square className="h-4 w-4 mr-2" />
                Graceful Shutdown
              </Button>

              <Button
                onClick={() => handleActionClick('ForceRestart')}
                disabled={isSubmitting}
                className="w-full justify-start"
                variant="outline"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Force Restart
              </Button>

              <Button
                onClick={() => handleActionClick('ForceOff')}
                disabled={isSubmitting}
                className="w-full justify-start"
                variant="destructive"
              >
                <AlertTriangle className="h-4 w-4 mr-2" />
                Force Power Off
              </Button>
            </div>

            <div className="text-xs text-muted-foreground p-3 rounded-lg bg-muted/30">
              <p><strong>Note:</strong> Force actions may cause data loss. Use graceful shutdown when possible.</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog for Destructive Actions */}
      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm {confirmAction}</AlertDialogTitle>
            <AlertDialogDescription>
              This is a destructive action that may cause data loss or service interruption.
              Are you sure you want to {confirmAction === 'ForceOff' ? 'force power off' : 'force restart'} {server.hostname || server.ip_address}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmAction && handlePowerAction(confirmAction)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Confirm {confirmAction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}