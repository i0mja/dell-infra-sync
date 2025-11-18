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
            The server at IP {serverIp} has been added. Create a discovery job to fetch comprehensive details from iDRAC.
          </DialogDescription>
        </DialogHeader>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            <strong>Status:</strong> Basic information only
            <br />
            <strong>Next:</strong> Complete onboarding via discovery job
          </AlertDescription>
        </Alert>

        <div className="space-y-3 text-sm text-muted-foreground">
          <p><strong>Comprehensive Discovery includes:</strong></p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Server hardware details (model, service tag, CPU, RAM)</li>
            <li>Health status (storage, thermal, power)</li>
            <li>BIOS & iDRAC firmware versions</li>
            <li>Configuration backup (SCP export)</li>
            <li>Recent event logs (last 50 entries)</li>
          </ul>
          <p className="text-xs italic">
            Onboarding takes ~10-15 seconds per server with proper API rate limiting.
          </p>
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
