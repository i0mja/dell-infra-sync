import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { usePagination } from "@/hooks/usePagination";
import { TablePagination } from "@/components/ui/table-pagination";

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
  className?: string;
  visibleColumns?: string[];
  onToggleColumn?: (column: string) => void;
}

export const CommandsTable = ({
  commands,
  selectedId,
  onRowClick,
  isLive,
  className,
  visibleColumns,
  onToggleColumn,
}: CommandsTableProps) => {
  const defaultColumns = ["time", "operation", "endpoint", "type", "status", "response"];
  
  const isColVisible = (col: string) => {
    if (visibleColumns) {
      return visibleColumns.includes(col);
    }
    return defaultColumns.includes(col);
  };
  const getOperationBadge = (type: string) => {
    const variants: Record<string, string> = {
      idrac_api: "bg-blue-500/10 text-blue-500 border-blue-500/20",
      vcenter_api: "bg-purple-500/10 text-purple-500 border-purple-500/20",
      openmanage_api: "bg-orange-500/10 text-orange-500 border-orange-500/20",
      ldap_api: "bg-green-500/10 text-green-500 border-green-500/20",
      ssh_command: "bg-amber-500/10 text-amber-500 border-amber-500/20"
    };
    
    const labels: Record<string, string> = {
      idrac_api: "iDRAC",
      vcenter_api: "vCenter",
      openmanage_api: "OME",
      ldap_api: "IDM/LDAP",
      ssh_command: "SSH"
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

  // Apply pagination
  const pagination = usePagination(commands, "commands-pagination", 50);

  return (
    <div
      className={cn(
        "flex flex-col h-full overflow-hidden rounded-lg border",
        isLive ? "border-emerald-500/30" : "border-border",
        className
      )}
    >
      <div className="flex-1 overflow-auto">
          <Table className="min-w-full">
            <TableHeader className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
              <TableRow>
                {isColVisible("time") && <TableHead className="w-[120px]">Time</TableHead>}
                {isColVisible("operation") && <TableHead className="w-[140px]">Operation</TableHead>}
                {isColVisible("endpoint") && <TableHead>Endpoint</TableHead>}
                {isColVisible("type") && <TableHead className="w-[110px]">Type</TableHead>}
                {isColVisible("status") && <TableHead className="w-[110px]">Status</TableHead>}
                {isColVisible("response") && <TableHead className="w-[110px] text-right">Response (ms)</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagination.paginatedItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No commands found
                  </TableCell>
                </TableRow>
              ) : (
                pagination.paginatedItems.map((command) => (
                  <TableRow
                    key={command.id}
                    onClick={() => onRowClick(command)}
                    className={cn(
                      "cursor-pointer transition-colors",
                      selectedId === command.id
                        ? "bg-primary/5 ring-1 ring-primary/40 hover:bg-primary/10"
                        : "hover:bg-muted/50"
                    )}
                    data-state={selectedId === command.id ? 'selected' : undefined}
                  >
                    {isColVisible("time") && (
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {formatTime(command.timestamp)}
                      </TableCell>
                    )}
                    {isColVisible("operation") && (
                      <TableCell>
                        {getOperationBadge(command.operation_type)}
                      </TableCell>
                    )}
                    {isColVisible("endpoint") && (
                      <TableCell className="font-mono text-xs">
                        <span title={command.endpoint}>{formatEndpoint(command.endpoint)}</span>
                      </TableCell>
                    )}
                    {isColVisible("type") && (
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">
                          {command.command_type}
                        </Badge>
                      </TableCell>
                    )}
                    {isColVisible("status") && (
                      <TableCell>
                        {getStatusBadge(command.success, command.status_code)}
                      </TableCell>
                    )}
                    {isColVisible("response") && (
                      <TableCell className="text-right font-mono text-xs">
                        {command.response_time_ms || '-'}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
      </div>
      
      <TablePagination
        currentPage={pagination.currentPage}
        totalPages={pagination.totalPages}
        totalItems={commands.length}
        pageSize={pagination.pageSize}
        startIndex={pagination.startIndex}
        endIndex={pagination.endIndex}
        onPageChange={pagination.setPage}
        onPageSizeChange={pagination.setPageSize}
        onFirstPage={pagination.goToFirstPage}
        onLastPage={pagination.goToLastPage}
        onNextPage={pagination.goToNextPage}
        onPrevPage={pagination.goToPrevPage}
        canGoNext={pagination.canGoNext}
        canGoPrev={pagination.canGoPrev}
      />
    </div>
  );
};
