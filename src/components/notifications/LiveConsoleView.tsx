import { useEffect, useRef, useState } from 'react';
import { Activity, Play, Pause, Trash2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useLiveConsole } from '@/hooks/useLiveConsole';
import { toast } from 'sonner';

export function LiveConsoleView() {
  const { 
    logs, 
    isStreaming, 
    isPaused, 
    activeJobs,
    selectedJobId,
    togglePause, 
    clearConsole,
    filterByJob,
    copyToClipboard
  } = useLiveConsole();
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  
  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && !isPaused && scrollRef.current) {
      const scrollElement = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }
    }
  }, [logs, autoScroll, isPaused]);

  const handleCopy = () => {
    copyToClipboard();
    toast.success('Console logs copied to clipboard');
  };

  const handleClear = () => {
    clearConsole();
    toast.success('Console cleared');
  };

  const getLogColorClass = (level: string) => {
    switch (level) {
      case 'success':
        return 'text-green-400';
      case 'error':
        return 'text-red-400';
      case 'warning':
        return 'text-yellow-400';
      case 'info':
        return 'text-blue-400';
      default:
        return 'text-muted-foreground';
    }
  };
  
  return (
    <div className="flex flex-col h-[500px]">
      {/* Controls Bar */}
      <div className="flex items-center justify-between p-3 border-b bg-muted/30 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Badge variant={isStreaming ? "default" : "secondary"} className="gap-1">
            {isStreaming ? (
              <>
                <Activity className="h-3 w-3 animate-pulse" />
                Streaming
              </>
            ) : (
              <>
                <Activity className="h-3 w-3" />
                Idle
              </>
            )}
          </Badge>
          
          <Button size="sm" variant="ghost" onClick={togglePause}>
            {isPaused ? (
              <>
                <Play className="h-4 w-4 mr-1" />
                Resume
              </>
            ) : (
              <>
                <Pause className="h-4 w-4 mr-1" />
                Pause
              </>
            )}
          </Button>
          
          <Button size="sm" variant="ghost" onClick={handleClear}>
            <Trash2 className="h-4 w-4 mr-1" />
            Clear
          </Button>
          
          <Button size="sm" variant="ghost" onClick={handleCopy}>
            <Copy className="h-4 w-4 mr-1" />
            Copy
          </Button>
        </div>
        
        {/* Filter Dropdown */}
        <Select value={selectedJobId} onValueChange={filterByJob}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Jobs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Jobs</SelectItem>
            {activeJobs.map(job => (
              <SelectItem key={job.id} value={job.id}>
                {job.job_type.replace(/_/g, ' ')} ({job.id.slice(0, 8)})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      
      {/* Console Output */}
      <ScrollArea 
        ref={scrollRef}
        className="flex-1 font-mono text-sm bg-[hsl(0,0%,4%)] p-4"
      >
        {logs.length === 0 ? (
          <div className="text-muted-foreground italic">
            {isPaused ? 'Console paused. Click Resume to continue streaming.' : 'Waiting for job activity...'}
          </div>
        ) : (
          <div className="space-y-0.5">
            {logs.map((entry, index) => (
              <div 
                key={entry.id}
                className="leading-relaxed"
              >
                <span className="text-muted-foreground/60">[{entry.timestamp}]</span>
                {' '}
                <span className="text-muted-foreground/80">{entry.jobType}:</span>
                {' '}
                <span className={cn(getLogColorClass(entry.level))}>
                  {entry.message}
                </span>
              </div>
            ))}
          </div>
        )}
        
        {/* Blinking cursor when streaming */}
        {isStreaming && !isPaused && logs.length > 0 && (
          <span className="inline-block w-2 h-4 bg-green-500 animate-pulse ml-1 mt-1">▌</span>
        )}
      </ScrollArea>
      
      {/* Footer Stats */}
      <div className="flex items-center justify-between px-3 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
        <span>{logs.length} {logs.length === 1 ? 'entry' : 'entries'}</span>
        <div className="flex items-center gap-4">
          <span>Auto-scroll: {autoScroll ? 'ON' : 'OFF'}</span>
          {activeJobs.length > 0 && (
            <span>{activeJobs.length} active {activeJobs.length === 1 ? 'job' : 'jobs'}</span>
          )}
        </div>
      </div>
    </div>
  );
}
