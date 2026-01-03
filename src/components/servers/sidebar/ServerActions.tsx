import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Activity,
  RefreshCw,
  Power,
  Monitor,
  Settings,
  HardDrive,
  Save,
  Network,
  ScrollText,
  Eye,
  FileText,
  Key,
  Link,
  GitBranch,
  Wrench,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import type { Server } from "@/hooks/useServers";

interface ServerActionsProps {
  server: Server;
  refreshing: boolean;
  testing: boolean;
  launchingConsole: boolean;
  onTestConnection: () => void;
  onRefreshInfo: () => void;
  onPowerControl: () => void;
  onLaunchConsole: () => void;
  onBiosConfig: () => void;
  onBootConfig: () => void;
  onVirtualMedia: () => void;
  onScpBackup: () => void;
  onNetworkSettings: () => void;
  onViewEventLog: () => void;
  onViewHealth: () => void;
  onViewAudit: () => void;
  onAssignCredentials: () => void;
  onLinkVCenter: () => void;
  onViewProperties: () => void;
  onWorkflow: () => void;
  onCreateJob: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function ServerActions({
  server,
  refreshing,
  testing,
  launchingConsole,
  onTestConnection,
  onRefreshInfo,
  onPowerControl,
  onLaunchConsole,
  onBiosConfig,
  onBootConfig,
  onVirtualMedia,
  onScpBackup,
  onNetworkSettings,
  onViewEventLog,
  onViewHealth,
  onViewAudit,
  onAssignCredentials,
  onLinkVCenter,
  onViewProperties,
  onWorkflow,
  onCreateJob,
  onEdit,
  onDelete,
}: ServerActionsProps) {
  return (
    <div className="space-y-3">
      {/* Quick Actions Grid */}
      <div>
        <h4 className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wider">
          Quick Actions
        </h4>
        <div className="grid grid-cols-4 gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-9 flex-col gap-0.5 text-[10px] font-normal"
            onClick={onTestConnection}
            disabled={testing}
            title="Test Connection"
          >
            {testing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Activity className="h-4 w-4" />
            )}
            <span>Test</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 flex-col gap-0.5 text-[10px] font-normal"
            onClick={onRefreshInfo}
            disabled={refreshing}
            title="Refresh Info"
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span>Refresh</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 flex-col gap-0.5 text-[10px] font-normal"
            onClick={onPowerControl}
            title="Power Controls"
          >
            <Power className="h-4 w-4" />
            <span>Power</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 flex-col gap-0.5 text-[10px] font-normal"
            onClick={onLaunchConsole}
            disabled={launchingConsole}
            title="Launch Console"
          >
            {launchingConsole ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Monitor className="h-4 w-4" />
            )}
            <span>Console</span>
          </Button>
        </div>
      </div>

      <Separator />

      {/* Organized Action Groups */}
      <Accordion type="single" collapsible className="w-full">
        {/* Configuration */}
        <AccordionItem value="config" className="border-b-0">
          <AccordionTrigger className="py-2 text-xs font-semibold hover:no-underline">
            Configuration
          </AccordionTrigger>
          <AccordionContent className="grid grid-cols-2 gap-1 pb-2">
            <Button variant="ghost" size="sm" className="justify-start h-8 text-xs" onClick={onBiosConfig}>
              <Settings className="mr-2 h-3 w-3" />
              BIOS
            </Button>
            <Button variant="ghost" size="sm" className="justify-start h-8 text-xs" onClick={onBootConfig}>
              <HardDrive className="mr-2 h-3 w-3" />
              Boot
            </Button>
            <Button variant="ghost" size="sm" className="justify-start h-8 text-xs" onClick={onVirtualMedia}>
              <Monitor className="mr-2 h-3 w-3" />
              Media
            </Button>
            <Button variant="ghost" size="sm" className="justify-start h-8 text-xs" onClick={onScpBackup}>
              <Save className="mr-2 h-3 w-3" />
              SCP
            </Button>
            <Button variant="ghost" size="sm" className="justify-start h-8 text-xs col-span-2" onClick={onNetworkSettings}>
              <Network className="mr-2 h-3 w-3" />
              Network Settings
            </Button>
          </AccordionContent>
        </AccordionItem>

        {/* Logs & Diagnostics */}
        <AccordionItem value="logs" className="border-b-0">
          <AccordionTrigger className="py-2 text-xs font-semibold hover:no-underline">
            Logs & Diagnostics
          </AccordionTrigger>
          <AccordionContent className="grid grid-cols-2 gap-1 pb-2">
            <Button variant="ghost" size="sm" className="justify-start h-8 text-xs" onClick={onViewEventLog}>
              <ScrollText className="mr-2 h-3 w-3" />
              Events
            </Button>
            <Button variant="ghost" size="sm" className="justify-start h-8 text-xs" onClick={onViewHealth}>
              <Eye className="mr-2 h-3 w-3" />
              Health
            </Button>
            <Button variant="ghost" size="sm" className="justify-start h-8 text-xs col-span-2" onClick={onViewAudit}>
              <FileText className="mr-2 h-3 w-3" />
              Audit Trail
            </Button>
          </AccordionContent>
        </AccordionItem>

        {/* Management */}
        <AccordionItem value="management" className="border-b-0">
          <AccordionTrigger className="py-2 text-xs font-semibold hover:no-underline">
            Management
          </AccordionTrigger>
          <AccordionContent className="grid grid-cols-2 gap-1 pb-2">
            <Button variant="ghost" size="sm" className="justify-start h-8 text-xs" onClick={onAssignCredentials}>
              <Key className="mr-2 h-3 w-3" />
              Credentials
            </Button>
            <Button variant="ghost" size="sm" className="justify-start h-8 text-xs" onClick={onLinkVCenter}>
              <Link className="mr-2 h-3 w-3" />
              vCenter
            </Button>
            <Button variant="ghost" size="sm" className="justify-start h-8 text-xs" onClick={onViewProperties}>
              <Eye className="mr-2 h-3 w-3" />
              Properties
            </Button>
            <Button variant="ghost" size="sm" className="justify-start h-8 text-xs" onClick={onWorkflow}>
              <GitBranch className="mr-2 h-3 w-3" />
              Workflow
            </Button>
            <Button variant="ghost" size="sm" className="justify-start h-8 text-xs col-span-2" onClick={onCreateJob}>
              <Wrench className="mr-2 h-3 w-3" />
              Create Job
            </Button>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <Separator />

      {/* Edit / Delete */}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" className="h-8" onClick={onEdit}>
          <Pencil className="mr-2 h-3 w-3" />
          Edit
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-destructive hover:text-destructive" onClick={onDelete}>
          <Trash2 className="mr-2 h-3 w-3" />
          Delete
        </Button>
      </div>
    </div>
  );
}
