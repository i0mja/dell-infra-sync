import { TabsTrigger } from "@/components/ui/tabs";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface SyncableTabTriggerProps {
  value: string;
  label: string;
  count?: number;
  onSync: () => void;
  syncing: boolean;
  syncLabel?: string;
}

export function SyncableTabTrigger({
  value,
  label,
  count,
  onSync,
  syncing,
  syncLabel,
}: SyncableTabTriggerProps) {
  const displayLabel = count !== undefined ? `${label} (${count})` : label;
  const syncText = syncLabel || `Sync ${label} Only`;

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <TabsTrigger
          value={value}
          className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3"
        >
          {displayLabel}
        </TabsTrigger>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem
          onClick={(e) => {
            e.preventDefault();
            onSync();
          }}
          disabled={syncing}
          className="gap-2"
        >
          <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
          {syncing ? "Syncing..." : syncText}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
