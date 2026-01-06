import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Monitor,
  RefreshCw,
  Download,
  MoreHorizontal,
  Power,
  Activity,
  Settings,
} from "lucide-react";

interface ServerQuickActionBarProps {
  onLaunchConsole?: () => void;
  onSync?: () => void;
  onCheckForUpdates?: () => void;
  onPowerControl?: () => void;
  onViewHealth?: () => void;
  onSettings?: () => void;
  isRefreshing?: boolean;
  isLaunchingConsole?: boolean;
}

export function ServerQuickActionBar({
  onLaunchConsole,
  onSync,
  onCheckForUpdates,
  onPowerControl,
  onViewHealth,
  onSettings,
  isRefreshing,
  isLaunchingConsole,
}: ServerQuickActionBarProps) {
  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="outline"
        size="sm"
        className="flex-1 h-8 text-xs"
        onClick={onLaunchConsole}
        disabled={isLaunchingConsole}
      >
        <Monitor className="h-3.5 w-3.5 mr-1.5" />
        Console
      </Button>
      
      <Button
        variant="outline"
        size="sm"
        className="flex-1 h-8 text-xs"
        onClick={onSync}
        disabled={isRefreshing}
      >
        <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRefreshing ? 'animate-spin' : ''}`} />
        Sync
      </Button>
      
      <Button
        variant="outline"
        size="sm"
        className="flex-1 h-8 text-xs"
        onClick={onCheckForUpdates}
      >
        <Download className="h-3.5 w-3.5 mr-1.5" />
        Updates
      </Button>
      
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" className="h-8 w-8">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={onPowerControl}>
            <Power className="h-4 w-4 mr-2" />
            Power Control
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onViewHealth}>
            <Activity className="h-4 w-4 mr-2" />
            Health Details
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onSettings}>
            <Settings className="h-4 w-4 mr-2" />
            All Settings
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
