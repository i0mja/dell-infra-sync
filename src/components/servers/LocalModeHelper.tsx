import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Copy, Terminal, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface LocalModeHelperProps {
  show: boolean;
}

export const LocalModeHelper = ({ show }: LocalModeHelperProps) => {
  const { toast } = useToast();
  
  if (!show) return null;

  const copyCommand = (command: string) => {
    navigator.clipboard.writeText(command);
    toast({
      title: "Copied to clipboard",
      description: "Paste in your terminal to start Job Executor",
    });
  };

  // Get values from environment
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "http://127.0.0.1:54321";
  const serviceRoleKey = "your-service-role-key"; // User needs to get this from settings

  const linuxCommand = `export DSM_URL="${supabaseUrl}" && export SERVICE_ROLE_KEY="${serviceRoleKey}" && python3 job-executor.py`;
  const windowsCommand = `$env:DSM_URL="${supabaseUrl}"; $env:SERVICE_ROLE_KEY="${serviceRoleKey}"; python job-executor.py`;

  return (
    <Alert className="border-amber-500/50 bg-amber-500/10">
      <Terminal className="h-4 w-4 text-amber-500" />
      <AlertDescription className="space-y-3">
        <div className="text-sm">
          <strong className="text-foreground">Waiting for Job Executor</strong>
          <p className="text-muted-foreground mt-1">
            This operation requires the Job Executor running on your local network. Start it with:
          </p>
        </div>
        
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground font-semibold">Linux/macOS:</div>
          <div className="flex gap-2">
            <code className="flex-1 p-2 bg-muted rounded text-xs font-mono break-all">
              {linuxCommand}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => copyCommand(linuxCommand)}
            >
              <Copy className="h-3 w-3" />
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs text-muted-foreground font-semibold">Windows PowerShell:</div>
          <div className="flex gap-2">
            <code className="flex-1 p-2 bg-muted rounded text-xs font-mono break-all">
              {windowsCommand}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => copyCommand(windowsCommand)}
            >
              <Copy className="h-3 w-3" />
            </Button>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.open('/activity', '_blank')}
            className="gap-2"
          >
            <ExternalLink className="h-3 w-3" />
            View Activity Monitor
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.open('/maintenance-planner?tab=jobs', '_blank')}
            className="gap-2"
          >
            <ExternalLink className="h-3 w-3" />
            View Jobs
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          💡 Get your SERVICE_ROLE_KEY from Settings → System & Monitoring → Network Connectivity
        </p>
      </AlertDescription>
    </Alert>
  );
};
