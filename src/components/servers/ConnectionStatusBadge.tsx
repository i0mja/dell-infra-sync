import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle, XCircle, HelpCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ConnectionStatusBadgeProps {
  status: 'online' | 'offline' | 'unknown' | null;
  lastTest: string | null;
  error: string | null;
  credentialTestStatus?: string | null;
}

export function ConnectionStatusBadge({ status, lastTest, error, credentialTestStatus }: ConnectionStatusBadgeProps) {
  const getStatusConfig = () => {
    // Priority: Show credential status if invalid
    if (credentialTestStatus === 'invalid') {
      return {
        icon: XCircle,
        label: 'Credentials Required',
        variant: 'destructive' as const,
        className: 'bg-yellow-600 hover:bg-yellow-700 text-white border-transparent',
      };
    }
    
    switch (status) {
      case 'online':
        return {
          icon: CheckCircle,
          label: 'Online',
          variant: 'default' as const,
          className: 'bg-green-500 hover:bg-green-600 text-white border-transparent',
        };
      case 'offline':
        return {
          icon: XCircle,
          label: 'Offline',
          variant: 'destructive' as const,
          className: '',
        };
      default:
        return {
          icon: HelpCircle,
          label: 'Unknown',
          variant: 'secondary' as const,
          className: '',
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  const tooltipContent = () => {
    if (credentialTestStatus === 'invalid') {
      return "iDRAC detected but authentication failed with all credential sets.\nAssign valid credentials to access this server.";
    }
    
    if (!lastTest) return "Connection not tested yet";
    
    const timeAgo = formatDistanceToNow(new Date(lastTest), { addSuffix: true });
    
    if (status === 'offline' && error) {
      return `Last tested ${timeAgo}\nError: ${error}`;
    }
    
    return `Last tested ${timeAgo}`;
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant={config.variant} className={`${config.className} cursor-help`}>
            <Icon className="mr-1 h-3 w-3" />
            {config.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p className="whitespace-pre-line">{tooltipContent()}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
