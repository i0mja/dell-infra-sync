import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useState } from "react";

interface CommandDetailDialogProps {
  command: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandDetailDialog({ command, open, onOpenChange }: CommandDetailDialogProps) {
  const [copiedTab, setCopiedTab] = useState<string | null>(null);

  if (!command) return null;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTab(label);
    toast.success(`${label} copied to clipboard`);
    setTimeout(() => setCopiedTab(null), 2000);
  };

  const JsonDisplay = ({ data, label }: { data: any; label: string }) => {
    const jsonString = JSON.stringify(data, null, 2);
    const isCopied = copiedTab === label;

    return (
      <div className="relative">
        <Button
          size="sm"
          variant="outline"
          className="absolute top-2 right-2 z-10"
          onClick={() => copyToClipboard(jsonString, label)}
        >
          {isCopied ? (
            <>
              <CheckCheck className="h-4 w-4 mr-1" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-4 w-4 mr-1" />
              Copy
            </>
          )}
        </Button>
        <pre className="bg-muted p-4 rounded-lg text-xs overflow-auto max-h-96 font-mono">
          {jsonString}
        </pre>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span>Command Details</span>
            <Badge variant={command.success ? "default" : "destructive"}>
              {command.success ? 'Success' : 'Failed'}
            </Badge>
            <Badge className="bg-blue-600">{command.command_type}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Overview */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Timestamp:</span>
              <p className="font-mono">{format(new Date(command.timestamp), 'PPpp')}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Response Time:</span>
              <p className="font-semibold">{command.response_time_ms}ms</p>
            </div>
            <div>
              <span className="text-muted-foreground">Status Code:</span>
              <p className="font-semibold">{command.status_code || 'N/A'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Source:</span>
              <Badge variant="outline">{command.source}</Badge>
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground">Full URL:</span>
              <p className="font-mono text-xs break-all bg-muted p-2 rounded mt-1">
                {command.full_url}
              </p>
            </div>
            {command.error_message && (
              <div className="col-span-2">
                <span className="text-destructive font-semibold">Error Message:</span>
                <p className="text-destructive mt-1">{command.error_message}</p>
              </div>
            )}
          </div>

          {/* Tabs for detailed data */}
          <Tabs defaultValue="response" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="response">Response Body</TabsTrigger>
              <TabsTrigger value="request">Request Body</TabsTrigger>
              <TabsTrigger value="headers">Request Headers</TabsTrigger>
            </TabsList>

            <TabsContent value="response" className="mt-4">
              {command.response_body ? (
                <JsonDisplay data={command.response_body} label="Response Body" />
              ) : (
                <p className="text-muted-foreground text-center py-8">No response body</p>
              )}
            </TabsContent>

            <TabsContent value="request" className="mt-4">
              {command.request_body ? (
                <JsonDisplay data={command.request_body} label="Request Body" />
              ) : (
                <p className="text-muted-foreground text-center py-8">No request body</p>
              )}
            </TabsContent>

            <TabsContent value="headers" className="mt-4">
              {command.request_headers ? (
                <JsonDisplay data={command.request_headers} label="Request Headers" />
              ) : (
                <p className="text-muted-foreground text-center py-8">No request headers</p>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
