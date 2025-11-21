import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InfoIcon, X } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

interface ModeBannerProps {
  mode: 'job-executor' | 'cloud';
  vcenterHost: string | null;
  isLocal: boolean;
  isPrivate: boolean;
}

export function ModeBanner({ mode, vcenterHost, isLocal, isPrivate }: ModeBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();

  if (dismissed || mode === 'cloud') {
    return null;
  }

  return (
    <Alert className="mx-4 mt-4 relative">
      <InfoIcon className="h-4 w-4" />
      <Button
        variant="ghost"
        size="sm"
        className="absolute right-2 top-2 h-6 w-6 p-0"
        onClick={() => setDismissed(true)}
      >
        <X className="h-4 w-4" />
      </Button>
      <AlertTitle>⚙️ Job Executor Mode</AlertTitle>
      <AlertDescription>
        {isLocal && <span className="font-medium">Local deployment detected. </span>}
        {isPrivate && vcenterHost && (
          <span className="font-medium">Private vCenter detected ({vcenterHost}). </span>
        )}
        Sync operations will create jobs for your local Job Executor. 
        Ensure the Job Executor is running on your local network. Check{" "}
        <Button 
          variant="link" 
          className="h-auto p-0 text-xs underline" 
          onClick={() => navigate('/settings?tab=diagnostics')}
        >
          Settings → Diagnostics
        </Button>{" "}
        for Job Executor status.
      </AlertDescription>
    </Alert>
  );
}
