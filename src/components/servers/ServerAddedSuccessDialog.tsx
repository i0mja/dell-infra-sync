import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, Info } from "lucide-react";

interface ServerAddedSuccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverIp: string;
  onCreateDiscoveryJob: () => void;
}

export const ServerAddedSuccessDialog = ({ 
  open, 
  onOpenChange, 
  serverIp,
  onCreateDiscoveryJob 
}: ServerAddedSuccessDialogProps) => {
  const handleCreateJob = () => {
    onOpenChange(false);
    onCreateDiscoveryJob();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            <DialogTitle>Server Added Successfully!</DialogTitle>
          </div>
          <DialogDescription>
            Server IP: <span className="font-semibold text-foreground">{serverIp}</span>
          </DialogDescription>
        </DialogHeader>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            <strong>Status:</strong> Basic information only
            <br />
            <strong>Next:</strong> Fetch complete details from iDRAC
          </AlertDescription>
        </Alert>

        <div className="space-y-3 text-sm text-muted-foreground">
          <p>Discovery jobs use Job Executor to fetch:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Hostname, Model, Service Tag</li>
            <li>BIOS & iDRAC firmware versions</li>
            <li>Hardware configuration</li>
          </ul>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Do This Later
          </Button>
          <Button onClick={handleCreateJob}>
            Create Discovery Job Now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
