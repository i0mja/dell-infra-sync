import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, CheckCircle2, XCircle, Shield } from 'lucide-react';

interface CredentialTestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credential: {
    id: string;
    name: string;
    username: string;
    credential_type: 'idrac' | 'esxi';
  } | null;
}

export function CredentialTestDialog({ open, onOpenChange, credential }: CredentialTestDialogProps) {
  const { toast } = useToast();
  const [testIp, setTestIp] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleTest = async () => {
    if (!credential || !testIp) {
      toast({
        title: "IP Required",
        description: "Enter an IP address to test",
        variant: "destructive",
      });
      return;
    }

    setTesting(true);
    setResult(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .insert([{
          job_type: 'test_credentials',
          target_scope: { ip_address: testIp },
          credential_set_ids: [credential.id],
          created_by: user.id,
          status: 'pending'
        }])
        .select()
        .single();

      if (jobError) throw jobError;

      // Poll for result
      const pollInterval = setInterval(async () => {
        const { data: updatedJob } = await supabase
          .from('jobs')
          .select('*')
          .eq('id', job.id)
          .single();

        if (updatedJob?.status === 'completed') {
          clearInterval(pollInterval);
          setTesting(false);
          setResult({
            success: true,
            message: 'Connection successful - credentials are valid',
          });
        } else if (updatedJob?.status === 'failed') {
          clearInterval(pollInterval);
          setTesting(false);
          setResult({
            success: false,
            message: (updatedJob.details as any)?.message || 'Connection failed',
          });
        }
      }, 2000);

      // Timeout after 30 seconds
      setTimeout(() => {
        clearInterval(pollInterval);
        if (testing) {
          setTesting(false);
          setResult({
            success: false,
            message: 'Test timed out - Job Executor may not be running',
          });
        }
      }, 30000);

    } catch (error: any) {
      setTesting(false);
      setResult({
        success: false,
        message: error.message,
      });
    }
  };

  const handleClose = () => {
    setTestIp('');
    setResult(null);
    onOpenChange(false);
  };

  if (!credential) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Test Credential
          </DialogTitle>
          <DialogDescription>
            Test connection using this credential set
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-muted/30 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-medium">{credential.name}</span>
              <Badge variant="outline">
                {credential.credential_type === 'idrac' ? 'iDRAC' : 'ESXi'}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Username: {credential.username}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="test-ip">Target IP Address</Label>
            <Input
              id="test-ip"
              placeholder="192.168.1.100"
              value={testIp}
              onChange={(e) => setTestIp(e.target.value)}
              disabled={testing}
            />
          </div>

          {result && (
            <Alert variant={result.success ? 'default' : 'destructive'}>
              {result.success ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              <AlertDescription>{result.message}</AlertDescription>
            </Alert>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleClose} disabled={testing}>
              {result ? 'Close' : 'Cancel'}
            </Button>
            <Button onClick={handleTest} disabled={testing || !testIp}>
              {testing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Testing...
                </>
              ) : (
                'Test Connection'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
