import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Monitor, ExternalLink, CheckCircle2 } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ConsoleLaunchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string | null;
}

interface JobDetails {
  console_url?: string;
  error?: string;
  requires_login?: boolean;
  message?: string;
}

export function ConsoleLaunchDialog({ open, onOpenChange, jobId }: ConsoleLaunchDialogProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [consoleUrl, setConsoleUrl] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!open || !jobId) return;

    setStatus('loading');
    setError('');
    setConsoleUrl('');

    // Poll for job completion
    const pollInterval = setInterval(async () => {
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .select('status, details')
        .eq('id', jobId)
        .single();

      if (jobError) {
        setStatus('error');
        setError('Failed to fetch job status');
        clearInterval(pollInterval);
        return;
      }

      if (job.status === 'completed') {
        const details = job.details as JobDetails;
        const url = details?.console_url;
        if (url) {
          setConsoleUrl(url);
          setStatus('ready');
          // Store message for iDRAC8 fallback
          if (details.message) {
            setError(details.message);
          }
          clearInterval(pollInterval);
        } else {
          setStatus('error');
          setError('No console URL returned');
          clearInterval(pollInterval);
        }
      } else if (job.status === 'failed') {
        const details = job.details as JobDetails;
        setStatus('error');
        setError(details?.error || 'Console launch failed');
        clearInterval(pollInterval);
      }
    }, 1000);

    return () => clearInterval(pollInterval);
  }, [open, jobId]);

  const handleOpenConsole = () => {
    if (consoleUrl) {
      window.open(consoleUrl, '_blank', 'noopener,noreferrer');
      toast.success('Console opened in new tab');
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Monitor className="h-5 w-5" />
            Launch iDRAC Console
          </DialogTitle>
          <DialogDescription>
            Preparing authenticated console session
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {status === 'loading' && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Requesting console access from iDRAC...
              </p>
            </div>
          )}

          {status === 'ready' && (
            <>
              <Alert className="bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800">
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                <AlertDescription className="text-green-800 dark:text-green-200">
                  Console session ready! Click below to open.
                </AlertDescription>
              </Alert>

              {error && (
                <Alert className="bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800">
                  <AlertDescription className="text-blue-800 dark:text-blue-200">
                    {error}
                  </AlertDescription>
                </Alert>
              )}

              <Button 
                onClick={handleOpenConsole}
                className="w-full"
                size="lg"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Open Console in New Tab
              </Button>

              <p className="text-xs text-muted-foreground text-center">
                {error ? 'Console will open - login with your iDRAC credentials' : 'The console will open with automatic authentication'}
              </p>
            </>
          )}

          {status === 'error' && (
            <>
              <Alert variant="destructive">
                <AlertDescription>
                  {error}
                </AlertDescription>
              </Alert>

              <Button 
                onClick={() => onOpenChange(false)}
                variant="outline"
                className="w-full"
              >
                Close
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
