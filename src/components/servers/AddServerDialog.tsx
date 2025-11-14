import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Info, BookOpen } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ServerAddedSuccessDialog } from "./ServerAddedSuccessDialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface AddServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  onRequestDiscoveryJob?: (serverIp: string) => void;
}

export const AddServerDialog = ({ open, onOpenChange, onSuccess, onRequestDiscoveryJob }: AddServerDialogProps) => {
  const [loading, setLoading] = useState(false);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [addedServerIp, setAddedServerIp] = useState("");
  const [showQuickStartGuide, setShowQuickStartGuide] = useState(true);
  
  const [formData, setFormData] = useState({
    ip_address: "",
    hostname: "",
    notes: "",
  });
  
  const { toast } = useToast();

  // Detect if running in local mode
  const isLocalMode = import.meta.env.VITE_SUPABASE_URL?.includes('localhost') || 
                      import.meta.env.VITE_SUPABASE_URL?.includes('127.0.0.1');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const serverData: any = {
        ip_address: formData.ip_address,
        hostname: formData.hostname || null,
        notes: formData.notes || null,
        last_seen: new Date().toISOString(),
      };

      const { error } = await supabase.from("servers").insert([serverData]);

      if (error) throw error;

      // In local mode, show success dialog with option to create discovery job
      if (isLocalMode) {
        setAddedServerIp(formData.ip_address);
        setShowSuccessDialog(true);
      } else {
        toast({
          title: "Server Added",
          description: "Server has been successfully added to inventory",
        });
      }

      // Reset form
      setFormData({
        ip_address: "",
        hostname: "",
        notes: "",
      });
      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      toast({
        title: "Error adding server",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateDiscoveryJob = () => {
    if (onRequestDiscoveryJob) {
      onRequestDiscoveryJob(addedServerIp);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Add New Server</DialogTitle>
            <DialogDescription>
              {isLocalMode 
                ? "Add server by IP address, then run a discovery scan to fetch details"
                : "Enter server details to add to inventory"}
            </DialogDescription>
          </DialogHeader>

          {isLocalMode && (
            <Collapsible open={showQuickStartGuide} onOpenChange={setShowQuickStartGuide}>
              <CollapsibleTrigger asChild>
                <Button variant="outline" size="sm" className="w-full justify-between">
                  <span className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4" />
                    Local Deployment Quick Start
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {showQuickStartGuide ? "Hide" : "Show"}
                  </span>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription className="space-y-2">
                    <p className="font-semibold">In local deployments, follow these 3 steps:</p>
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li><strong>Step 1:</strong> Manually add server with IP address</li>
                      <li><strong>Step 2:</strong> Create Discovery Scan job (we'll help!)</li>
                      <li><strong>Step 3:</strong> Job Executor fetches all details</li>
                    </ol>
                    <p className="text-xs text-muted-foreground mt-2">
                      The Job Executor must be running on your host machine to fetch server details.
                    </p>
                  </AlertDescription>
                </Alert>
              </CollapsibleContent>
            </Collapsible>
          )}

          <ScrollArea className="max-h-[60vh] pr-4">
            <form id="add-server-form" onSubmit={handleSubmit} className="space-y-4">
              {/* IP Address Field */}
              <div className="space-y-2">
                <Label htmlFor="ip_address">IP Address *</Label>
                <Input
                  id="ip_address"
                  value={formData.ip_address}
                  onChange={(e) => setFormData({ ...formData, ip_address: e.target.value })}
                  placeholder="192.168.1.100"
                  required
                />
              </div>

              {/* Hostname Field (Optional) */}
              <div className="space-y-2">
                <Label htmlFor="hostname">Hostname (Optional)</Label>
                <Input
                  id="hostname"
                  value={formData.hostname}
                  onChange={(e) => setFormData({ ...formData, hostname: e.target.value })}
                  placeholder="e.g., server01"
                />
                <p className="text-xs text-muted-foreground">
                  If left blank, will be fetched during discovery scan
                </p>
              </div>

              {/* Notes Field */}
              <div className="space-y-2">
                <Label htmlFor="notes">Notes (Optional)</Label>
                <Textarea
                  id="notes"
                  placeholder="Any additional notes about this server..."
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                />
              </div>
            </form>
          </ScrollArea>

          {/* Action Buttons */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              form="add-server-form"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : (
                "Add Server"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ServerAddedSuccessDialog
        open={showSuccessDialog}
        onOpenChange={setShowSuccessDialog}
        serverIp={addedServerIp}
        onCreateDiscoveryJob={handleCreateDiscoveryJob}
      />
    </>
  );
};
