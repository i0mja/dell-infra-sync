import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

interface AssignCredentialsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: {
    id: string;
    ip_address: string;
    hostname: string | null;
  } | null;
  onSuccess?: () => void;
}

interface CredentialSet {
  id: string;
  name: string;
  username: string;
}

export function AssignCredentialsDialog({ open, onOpenChange, server, onSuccess }: AssignCredentialsDialogProps) {
  const [credentialSets, setCredentialSets] = useState<CredentialSet[]>([]);
  const [selectedSetId, setSelectedSetId] = useState<string>("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; responseTime?: number } | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      fetchCredentialSets();
      setTestResult(null);
      setSelectedSetId("");
    }
  }, [open]);

  const fetchCredentialSets = async () => {
    const { data, error } = await supabase
      .from("credential_sets")
      .select("id, name, username")
      .order("priority", { ascending: true });

    if (error) {
      console.error("Error fetching credential sets:", error);
      toast({
        title: "Error",
        description: "Failed to load credential sets",
        variant: "destructive",
      });
      return;
    }

    setCredentialSets(data || []);
  };

  const handleTestCredentials = async () => {
    if (!selectedSetId || !server) return;

    setTesting(true);
    setTestResult(null);

    try {
      const { data: result, error: invokeError } = await supabase.functions.invoke('test-idrac-connection', {
        body: {
          ip_address: server.ip_address,
          credential_set_id: selectedSetId,
        },
      });

      if (invokeError) throw invokeError;

      if (result.success) {
        setTestResult({
          success: true,
          message: `Successfully connected to iDRAC ${result.idrac_version || ""}`,
          responseTime: result.response_time_ms,
        });

        // Update server record with successful credential set
        const { error: updateError } = await supabase
          .from("servers")
          .update({
            credential_set_id: selectedSetId,
            credential_test_status: "valid",
            credential_last_tested: new Date().toISOString(),
            connection_status: "online",
            connection_error: null,
            last_connection_test: new Date().toISOString(),
          })
          .eq("id", server.id);

        if (updateError) throw updateError;

        toast({
          title: "Credentials Assigned",
          description: `Successfully assigned credentials to ${server.hostname || server.ip_address}`,
        });

        setTimeout(() => {
          onSuccess?.();
          onOpenChange(false);
        }, 1500);
      } else {
        setTestResult({
          success: false,
          message: result.error || "Authentication failed",
        });
      }
    } catch (error: any) {
      console.error("Error testing credentials:", error);
      setTestResult({
        success: false,
        message: error.message || "Failed to test credentials",
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Assign Credentials</DialogTitle>
          <DialogDescription>
            Select a credential set to test and assign to {server?.hostname || server?.ip_address}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="credential-set">Credential Set</Label>
            <Select value={selectedSetId} onValueChange={setSelectedSetId}>
              <SelectTrigger id="credential-set">
                <SelectValue placeholder="Select credential set..." />
              </SelectTrigger>
              <SelectContent>
                {credentialSets.map((set) => (
                  <SelectItem key={set.id} value={set.id}>
                    {set.name} ({set.username})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {testResult && (
            <Alert variant={testResult.success ? "default" : "destructive"}>
              <div className="flex items-start gap-2">
                {testResult.success ? (
                  <CheckCircle className="h-4 w-4 mt-0.5" />
                ) : (
                  <XCircle className="h-4 w-4 mt-0.5" />
                )}
                <AlertDescription className="flex-1">
                  {testResult.message}
                  {testResult.responseTime && (
                    <span className="block text-xs mt-1 opacity-70">
                      Response time: {testResult.responseTime}ms
                    </span>
                  )}
                </AlertDescription>
              </div>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleTestCredentials}
            disabled={!selectedSetId || testing || testResult?.success}
          >
            {testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {testResult?.success ? "Assigned" : "Test & Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
