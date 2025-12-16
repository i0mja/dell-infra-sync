import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  Key, 
  Server, 
  ArrowRight, 
  CheckCircle2, 
  XCircle, 
  Circle,
  AlertTriangle,
  Copy,
  Link,
  Shield
} from "lucide-react";

interface SshKeyExchangeResultsProps {
  details: Record<string, any> | null;
  status: string;
}

// Define the steps in order for display
const STEP_DEFINITIONS = [
  { key: 'source_key_obtained', label: 'Get SSH Key from Source', icon: Key },
  { key: 'key_copied_to_destination', label: 'Copy Key to Destination', icon: Copy },
  { key: 'connection_tested', label: 'Test SSH Connection', icon: ArrowRight },
  { key: 'trust_established', label: 'Establish Trust', icon: Shield },
  { key: 'ssh_key_linked', label: 'Link SSH Key Record', icon: Link },
];

// Map current_step values to display names
const STEP_NAMES: Record<string, string> = {
  'initializing': 'Initializing',
  'source_key_generation': 'Generating SSH Key on Source',
  'copy_key_to_destination': 'Copying Key to Destination',
  'test_ssh_connection': 'Testing SSH Connection',
  'establish_trust': 'Establishing Trust',
  'link_ssh_key': 'Linking SSH Key Record',
  'completed': 'Completed',
  'unknown': 'Unknown Step'
};

export function SshKeyExchangeResults({ details, status }: SshKeyExchangeResultsProps) {
  if (!details) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-sm">No details available</p>
        </CardContent>
      </Card>
    );
  }

  const {
    source_target,
    source_hostname,
    source_nfs_ip,
    source_target_id,
    destination_target,
    destination_hostname,
    destination_nfs_ip,
    destination_target_id,
    steps = [],
    error,
    failed_step,
    current_step
  } = details;

  // Check if SSH host differs from NFS IP
  const sourceHasDifferentSshHost = source_nfs_ip && source_hostname && source_nfs_ip !== source_hostname;
  const destHasDifferentSshHost = destination_nfs_ip && destination_hostname && destination_nfs_ip !== destination_hostname;

  const isCompleted = status === 'completed';
  const isFailed = status === 'failed';
  const isRunning = status === 'running';

  // Determine which steps are completed
  const completedSteps = new Set(steps);

  return (
    <div className="space-y-4">
      {/* Target Information */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Key className="h-4 w-4" />
            SSH Key Exchange
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Source and Destination */}
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Source</span>
              </div>
              <p className="text-sm font-mono mt-1">
                {source_target || source_target_id || 'Unknown'}
              </p>
              {source_hostname && (
                <p className="text-xs text-muted-foreground font-mono">
                  SSH: {source_hostname}
                </p>
              )}
              {sourceHasDifferentSshHost && source_nfs_ip && (
                <p className="text-xs text-muted-foreground/70 font-mono">
                  NFS: {source_nfs_ip}
                </p>
              )}
            </div>
            
            <ArrowRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Destination</span>
              </div>
              <p className="text-sm font-mono mt-1">
                {destination_target || destination_target_id || 'Unknown'}
              </p>
              {destination_hostname && (
                <p className="text-xs text-muted-foreground font-mono">
                  SSH: {destination_hostname}
                </p>
              )}
              {destHasDifferentSshHost && destination_nfs_ip && (
                <p className="text-xs text-muted-foreground/70 font-mono">
                  NFS: {destination_nfs_ip}
                </p>
              )}
            </div>
          </div>

          {/* Step Progress */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Progress</p>
            <div className="space-y-1.5">
              {STEP_DEFINITIONS.map((step, index) => {
                const StepIcon = step.icon;
                const isStepCompleted = completedSteps.has(step.key);
                const isStepFailed = failed_step && !isStepCompleted && 
                  STEP_DEFINITIONS.findIndex(s => s.key === step.key) >= 
                  STEP_DEFINITIONS.findIndex(s => completedSteps.has(s.key) || s.key === step.key);
                const isCurrentStep = current_step && STEP_NAMES[current_step]?.toLowerCase().includes(step.label.toLowerCase());
                
                // Determine if this is the failed step
                const isFailedStep = isFailed && !isStepCompleted && 
                  (index === completedSteps.size || 
                   (failed_step && step.key.includes(failed_step.replace(/_/g, ''))));

                return (
                  <div 
                    key={step.key}
                    className={`flex items-center gap-3 p-2 rounded-md transition-colors ${
                      isStepCompleted 
                        ? 'bg-green-500/10' 
                        : isFailedStep 
                          ? 'bg-destructive/10' 
                          : 'bg-muted/30'
                    }`}
                  >
                    <div className="flex-shrink-0">
                      {isStepCompleted ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : isFailedStep ? (
                        <XCircle className="h-4 w-4 text-destructive" />
                      ) : isRunning && index === completedSteps.size ? (
                        <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Circle className="h-4 w-4 text-muted-foreground/50" />
                      )}
                    </div>
                    <StepIcon className={`h-4 w-4 ${
                      isStepCompleted 
                        ? 'text-green-500' 
                        : isFailedStep 
                          ? 'text-destructive' 
                          : 'text-muted-foreground'
                    }`} />
                    <span className={`text-sm ${
                      isStepCompleted 
                        ? 'text-foreground' 
                        : isFailedStep 
                          ? 'text-destructive' 
                          : 'text-muted-foreground'
                    }`}>
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Status Messages */}
      {isCompleted && (
        <Alert className="border-green-500/50 bg-green-500/10">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <AlertTitle className="text-green-500">SSH Key Exchange Successful</AlertTitle>
          <AlertDescription>
            SSH trust has been established between {source_target || 'source'} and {destination_target || 'destination'}.
            Passwordless replication is now enabled.
          </AlertDescription>
        </Alert>
      )}

      {isFailed && error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>SSH Key Exchange Failed</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{error}</p>
            {failed_step && (
              <p className="text-xs opacity-80">
                Failed at step: {STEP_NAMES[failed_step] || failed_step}
              </p>
            )}
            <div className="mt-3 text-xs space-y-1 opacity-80">
              <p className="font-medium">Troubleshooting:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Verify both targets are reachable via SSH (port 22)</li>
                <li>Check that the admin password is correct</li>
                <li>Ensure SSH service is running on both targets</li>
                <li>Verify firewall rules allow SSH between targets</li>
              </ul>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {isRunning && current_step && (
        <Alert>
          <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <AlertTitle>In Progress</AlertTitle>
          <AlertDescription>
            {STEP_NAMES[current_step] || current_step}...
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
