import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Command {
  id: string;
  timestamp: string;
  operation_type: string;
  endpoint: string;
  full_url?: string;
  command_type: string;
  status_code: number | null;
  success: boolean;
  server_id: string | null;
  response_time_ms: number | null;
  source: string | null;
  job_id?: string | null;
  task_id?: string | null;
  initiated_by?: string | null;
  request_headers?: any;
  request_body?: any;
  response_body?: any;
  error_message?: string | null;
}

interface CommandsTableProps {
  commands: Command[];
  selectedId?: string;
  onRowClick: (command: Command) => void;
  isLive: boolean;
}

export const CommandsTable = ({
  commands,
  selectedId,
  onRowClick,
  isLive
}: CommandsTableProps) => {
  const getOperationBadge = (type: string) => {
    const variants: Record<string, string> = {
      idrac_api: "bg-blue-500/10 text-blue-500 border-blue-500/20",
      vcenter_api: "bg-purple-500/10 text-purple-500 border-purple-500/20",
      openmanage_api: "bg-orange-500/10 text-orange-500 border-orange-500/20"
    };
    
    const labels: Record<string, string> = {
      idrac_api: "iDRAC",
      vcenter_api: "vCenter",
      openmanage_api: "OME"
    };

    return (
      <Badge variant="outline" className={variants[type] || ""}>
        {labels[type] || type}
      </Badge>
    );
  };

  const getStatusBadge = (success: boolean, statusCode: number | null) => {
    if (success) {
      return (
        <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
          ✓ {statusCode}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20">
        ✗ {statusCode || 'ERR'}
      </Badge>
    );
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const formatEndpoint = (endpoint: string) => {
    if (endpoint.length > 30) {
      return endpoint.substring(0, 30) + '...';
    }
    return endpoint;
  };

  return (
    <div className="flex-1 flex flex-col border rounded-lg bg-card overflow-hidden">
      <div className="border-b px-4 py-3 flex items-center justify-between">
        <h3 className="font-semibold">Activity Feed</h3>
        <div className="text-xs text-muted-foreground">
          {commands.length} commands
        </div>
      </div>
      
      <ScrollArea className="flex-1">
        <Table>
          <TableHeader className="sticky top-0 bg-muted/50 z-10">
            <TableRow>
              <TableHead className="w-[90px]">Time</TableHead>
              <TableHead className="w-[120px]">Operation</TableHead>
              <TableHead>Endpoint</TableHead>
              <TableHead className="w-[80px]">Type</TableHead>
              <TableHead className="w-[90px]">Status</TableHead>
              <TableHead className="w-[80px]">Time (ms)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {commands.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No commands found
                </TableCell>
              </TableRow>
            ) : (
              commands.map((command) => (
                <TableRow
                  key={command.id}
                  onClick={() => onRowClick(command)}
                  className={`cursor-pointer transition-colors ${
                    selectedId === command.id 
                      ? 'bg-primary/5 hover:bg-primary/10' 
                      : 'hover:bg-muted/50'
                  }`}
                >
                  <TableCell className="font-mono text-xs">
                    {formatTime(command.timestamp)}
                  </TableCell>
                  <TableCell>
                    {getOperationBadge(command.operation_type)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatEndpoint(command.endpoint)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-xs">
                      {command.command_type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {getStatusBadge(command.success, command.status_code)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {command.response_time_ms || '-'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
};
