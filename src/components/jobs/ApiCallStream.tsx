import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useJobApiStream, ApiCall } from '@/hooks/useJobApiStream';
import { ChevronDown, ChevronRight, Circle, Copy, Pause, Play, Trash2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

interface ApiCallStreamProps {
  jobId: string;
}

export const ApiCallStream = ({ jobId }: ApiCallStreamProps) => {
  const { apiCalls, loading, isLive, toggleLive, clearCalls, copyAllToClipboard } = useJobApiStream(jobId);
  const [expandedCall, setExpandedCall] = useState<string | null>(null);
  const [filterErrors, setFilterErrors] = useState(false);

  const filteredCalls = filterErrors 
    ? apiCalls.filter(call => !call.success || (call.status_code && call.status_code >= 400))
    : apiCalls;

  const getStatusColor = (statusCode: number | null, success: boolean) => {
    if (!success || (statusCode && statusCode >= 500)) return 'text-destructive';
    if (statusCode && statusCode >= 400) return 'text-warning';
    if (statusCode && statusCode >= 200 && statusCode < 300) return 'text-success';
    return 'text-muted-foreground';
  };

  const getMethodBadge = (method: string, operationType?: string) => {
    // For SSH commands, show special badge
    if (operationType === 'ssh_command') {
      return (
        <Badge variant="outline" className="font-mono text-xs bg-amber-500/10 text-amber-500 border-amber-500/20">
          SSH
        </Badge>
      );
    }
    
    const colors: Record<string, string> = {
      GET: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
      POST: 'bg-green-500/10 text-green-500 border-green-500/20',
      PATCH: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
      PUT: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
      DELETE: 'bg-red-500/10 text-red-500 border-red-500/20',
    };
    return (
      <Badge variant="outline" className={cn('font-mono text-xs', colors[method] || '')}>
        {method}
      </Badge>
    );
  };

  const renderJsonContent = (content: any) => {
    if (!content) return null;
    if (content._truncated) {
      return (
        <Alert className="mt-2">
          <AlertDescription className="text-xs">
            Content truncated: {content._original_size_kb}KB (limit: {content._limit_kb}KB)
          </AlertDescription>
        </Alert>
      );
    }
    return (
      <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-muted p-3 rounded mt-2">
        {typeof content === 'string' ? content : JSON.stringify(content, null, 2)}
      </pre>
    );
  };

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (apiCalls.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-muted-foreground">
          No API calls captured yet. API calls will appear here as the job executes.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            {isLive ? (
              <Circle className="h-2 w-2 fill-destructive text-destructive animate-pulse" />
            ) : (
              <Circle className="h-2 w-2 fill-muted-foreground text-muted-foreground" />
            )}
            <span className="text-sm font-medium">
              {isLive ? 'LIVE' : 'PAUSED'}
            </span>
          </div>
          <Badge variant="outline">{filteredCalls.length} calls</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={filterErrors ? 'default' : 'outline'}
            onClick={() => setFilterErrors(!filterErrors)}
          >
            {filterErrors ? 'Show All' : 'Errors Only'}
          </Button>
          <Button size="sm" variant="outline" onClick={toggleLive}>
            {isLive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button size="sm" variant="outline" onClick={copyAllToClipboard}>
            <Copy className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={clearCalls}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* API Call Stream */}
      <Card className="border-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono">API Call Stream</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px] pr-4">
            <div className="space-y-2">
              {filteredCalls.map((call) => {
                const isExpanded = expandedCall === call.id;
                const method = call.command_type || 'GET';
                
                return (
                  <div
                    key={call.id}
                    className="border rounded-lg p-3 space-y-2 hover:bg-accent/50 transition-colors"
                  >
                    {/* Call Summary */}
                    <div
                      className="flex items-start gap-3 cursor-pointer"
                      onClick={() => setExpandedCall(isExpanded ? null : call.id)}
                    >
                      <div className="flex-shrink-0 pt-0.5">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-muted-foreground font-mono">
                            {new Date(call.timestamp).toLocaleTimeString()}.
                            {new Date(call.timestamp).getMilliseconds().toString().padStart(3, '0')}
                          </span>
                          {getMethodBadge(method, call.operation_type)}
                          <Badge 
                            variant="outline" 
                            className={cn('font-mono', getStatusColor(call.status_code, call.success))}
                          >
                            {call.status_code || 'N/A'}
                          </Badge>
                          {call.response_time_ms && (
                            <span className="text-xs text-muted-foreground">
                              {call.response_time_ms}ms
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-mono break-all text-muted-foreground">
                          {call.endpoint}
                        </p>
                        {call.error_message && (
                          <div className="flex items-start gap-1">
                            <span className="text-xs text-destructive">✗</span>
                            <span className="text-xs text-destructive break-all">
                              {call.error_message}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <div className="pl-7 space-y-3 border-t pt-3">
                        {/* Full URL */}
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-1">Full URL</p>
                          <p className="text-xs font-mono break-all bg-muted p-2 rounded">
                            {call.full_url}
                          </p>
                        </div>

                        {/* Request Body */}
                        {call.request_body && (
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground mb-1">Request Body</p>
                            {renderJsonContent(call.request_body)}
                          </div>
                        )}

                        {/* Response Body */}
                        {call.response_body && (
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground mb-1">
                              Response ({call.status_code})
                            </p>
                            {renderJsonContent(call.response_body)}
                          </div>
                        )}

                        {/* Request Headers */}
                        {call.request_headers && (
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground mb-1">Request Headers</p>
                            {renderJsonContent(call.request_headers)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
};
