import { X, Copy, Expand } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Command {
  id: string;
  timestamp: string;
  operation_type: string;
  endpoint: string;
  full_url: string;
  command_type: string;
  status_code: number | null;
  success: boolean;
  response_time_ms: number | null;
  source: string | null;
  job_id: string | null;
  task_id: string | null;
  initiated_by: string | null;
  request_headers: any;
  request_body: any;
  response_body: any;
  error_message: string | null;
}

interface CommandDetailsSidebarProps {
  command: Command | null;
  onClose: () => void;
  onExpand?: () => void;
  className?: string;
}

export const CommandDetailsSidebar = ({
  command,
  onClose,
  onExpand,
  className
}: CommandDetailsSidebarProps) => {
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  if (!command) {
    return (
      <div className="border rounded-lg bg-card p-8 flex flex-col items-center justify-center text-center h-full">
        <div className="text-muted-foreground mb-2">No Command Selected</div>
        <div className="text-sm text-muted-foreground">
          Click a command in the table to view details
        </div>
      </div>
    );
  }

  const formatJson = (data: any) => {
    if (!data) return 'None';
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  return (
    <div className={cn("border rounded-lg bg-card flex flex-col h-full overflow-hidden", className)}>
      {/* Header */}
      <div className="border-b px-4 py-3 flex items-center gap-2">
        <h3 className="font-semibold">Command Details</h3>
        <div className="ml-auto flex items-center gap-2">
          {onExpand && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={onExpand}
            >
              <Expand className="mr-1 h-3.5 w-3.5" />
              Expand
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Overview */}
          <div className="space-y-3">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Endpoint</div>
              <div className="font-mono text-sm break-all">{command.endpoint}</div>
            </div>

            <div className="flex items-center gap-3">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Status</div>
                <Badge 
                  variant="outline" 
                  className={command.success 
                    ? "bg-green-500/10 text-green-500 border-green-500/20"
                    : "bg-red-500/10 text-red-500 border-red-500/20"
                  }
                >
                  {command.success ? '✓' : '✗'} {command.status_code || 'ERR'}
                </Badge>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Response Time</div>
                <div className="font-mono text-sm">{command.response_time_ms || '-'} ms</div>
              </div>
            </div>

            <div>
              <div className="text-xs text-muted-foreground mb-1">Timestamp</div>
              <div className="text-sm">{formatTimestamp(command.timestamp)}</div>
            </div>
          </div>

          {/* Source Info */}
          <div className="border-t pt-3">
            <div className="text-xs font-semibold text-muted-foreground mb-2">SOURCE</div>
            <div className="space-y-2 text-sm">
              {command.source && (
                <div>
                  <span className="text-muted-foreground">Source: </span>
                  <Badge variant="outline">{command.source}</Badge>
                </div>
              )}
              {command.job_id && (
                <div>
                  <span className="text-muted-foreground">Job: </span>
                  <span className="font-mono text-xs">{command.job_id.substring(0, 8)}...</span>
                </div>
              )}
              {command.task_id && (
                <div>
                  <span className="text-muted-foreground">Task: </span>
                  <span className="font-mono text-xs">{command.task_id.substring(0, 8)}...</span>
                </div>
              )}
              {command.initiated_by && (
                <div>
                  <span className="text-muted-foreground">Initiated by: </span>
                  <span className="text-xs">{command.initiated_by}</span>
                </div>
              )}
            </div>
          </div>

          {/* Tabs for Request/Response */}
          <div className="border-t pt-3">
            <Tabs defaultValue="response" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="response">Response</TabsTrigger>
                <TabsTrigger value="request">Request</TabsTrigger>
                <TabsTrigger value="headers">Headers</TabsTrigger>
              </TabsList>

              <TabsContent value="response" className="mt-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-muted-foreground">RESPONSE BODY</div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => copyToClipboard(formatJson(command.response_body), "Response")}
                    >
                      <Copy className="h-3 w-3 mr-1" />
                      Copy
                    </Button>
                  </div>
                  <pre className="text-xs bg-muted p-3 rounded-lg overflow-auto max-h-[400px] font-mono">
                    {formatJson(command.response_body)}
                  </pre>
                  {command.error_message && (
                    <div className="mt-2">
                      <div className="text-xs font-semibold text-destructive mb-1">ERROR</div>
                      <div className="text-xs bg-destructive/10 text-destructive p-2 rounded border border-destructive/20">
                        {command.error_message}
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="request" className="mt-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-muted-foreground">REQUEST BODY</div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => copyToClipboard(formatJson(command.request_body), "Request")}
                    >
                      <Copy className="h-3 w-3 mr-1" />
                      Copy
                    </Button>
                  </div>
                  <div className="mb-2">
                    <div className="text-xs text-muted-foreground mb-1">Full URL</div>
                    <div className="text-xs font-mono bg-muted p-2 rounded break-all">
                      {command.full_url}
                    </div>
                  </div>
                  <pre className="text-xs bg-muted p-3 rounded-lg overflow-auto max-h-[400px] font-mono">
                    {formatJson(command.request_body)}
                  </pre>
                </div>
              </TabsContent>

              <TabsContent value="headers" className="mt-3">
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground">REQUEST HEADERS</div>
                  <pre className="text-xs bg-muted p-3 rounded-lg overflow-auto max-h-[400px] font-mono">
                    {formatJson(command.request_headers)}
                  </pre>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};
