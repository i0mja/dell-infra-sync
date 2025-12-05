import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Clock, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface CancelJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  jobType: string;
  jobDetails?: any;
  onCancelled?: () => void;
}

// Job types that support graceful cancel
const GRACEFUL_CANCEL_JOB_TYPES = [
  'rolling_cluster_update',
  'prepare_host_for_update',
  'server_group_safety_check',
  'cluster_safety_check'
];

export function CancelJobDialog({ 
  open, 
  onOpenChange, 
  jobId, 
  jobType, 
  jobDetails,
  onCancelled 
}: CancelJobDialogProps) {
  const [cancelType, setCancelType] = useState<'graceful' | 'force'>('graceful');
  const [isLoading, setIsLoading] = useState(false);

  const supportsGracefulCancel = GRACEFUL_CANCEL_JOB_TYPES.includes(jobType);
  const isFirmwareInProgress = jobDetails?.current_step?.includes('firmware') || 
                               jobDetails?.current_step?.includes('Firmware') ||
                               jobDetails?.phase === 'firmware_updates';

  const handleCancel = async () => {
    setIsLoading(true);
    
    try {
      if (supportsGracefulCancel && cancelType === 'graceful') {
        // Graceful cancel: set flag in details, don't change status
        const { error } = await supabase.functions.invoke('update-job', {
          body: {
            job: {
              id: jobId,
              details: {
                ...(jobDetails || {}),
                graceful_cancel: true,
                graceful_cancel_requested_at: new Date().toISOString()
              }
            }
          }
        });

        if (error) throw error;

        toast({
          title: "Graceful cancel requested",
          description: "The job will stop after the current host completes.",
        });
      } else {
        // Force cancel: set status to cancelled immediately
        const { error } = await supabase.functions.invoke('update-job', {
          body: {
            job: {
              id: jobId,
              status: 'cancelled',
              completed_at: new Date().toISOString(),
            }
          }
        });

        if (error) throw error;

        toast({
          title: "Job cancelled",
          description: "The job has been cancelled. Cleanup is in progress.",
        });
      }

      onCancelled?.();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: "Failed to cancel job",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-destructive" />
            Cancel Job
          </AlertDialogTitle>
          <AlertDialogDescription>
            {supportsGracefulCancel ? (
              "Choose how you want to cancel this job."
            ) : (
              "Are you sure you want to cancel this job? This action cannot be undone."
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {supportsGracefulCancel && (
          <div className="space-y-4 py-4">
            <RadioGroup 
              value={cancelType} 
              onValueChange={(v) => setCancelType(v as 'graceful' | 'force')}
              className="space-y-3"
            >
              <div className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer">
                <RadioGroupItem value="graceful" id="graceful" className="mt-1" />
                <div className="flex-1">
                  <Label htmlFor="graceful" className="flex items-center gap-2 cursor-pointer font-medium">
                    <Clock className="h-4 w-4 text-primary" />
                    Graceful Cancel (Recommended)
                  </Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Finish the current host's update cycle, then stop processing remaining hosts.
                    This is the safest option to avoid leaving servers in an unstable state.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer">
                <RadioGroupItem value="force" id="force" className="mt-1" />
                <div className="flex-1">
                  <Label htmlFor="force" className="flex items-center gap-2 cursor-pointer font-medium">
                    <XCircle className="h-4 w-4 text-destructive" />
                    Force Cancel
                  </Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Stop immediately and exit maintenance mode for all hosts.
                    iDRAC job queues will be cleared.
                  </p>
                </div>
              </div>
            </RadioGroup>

            {cancelType === 'force' && isFirmwareInProgress && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Warning:</strong> Firmware update may be in progress. 
                  Force cancelling during a firmware flash could leave the server in an unstable state.
                  Consider using graceful cancel instead.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Keep Running</AlertDialogCancel>
          <AlertDialogAction 
            onClick={handleCancel}
            disabled={isLoading}
            className={cancelType === 'force' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
          >
            {isLoading ? 'Cancelling...' : (
              supportsGracefulCancel 
                ? (cancelType === 'graceful' ? 'Graceful Cancel' : 'Force Cancel')
                : 'Cancel Job'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
