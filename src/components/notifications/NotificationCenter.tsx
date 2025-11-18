import { useState } from 'react';
import { Bell, Activity, Clock, ExternalLink, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useNotificationCenter } from '@/hooks/useNotificationCenter';
import { ActiveJobCard } from './ActiveJobCard';
import { RecentActivityItem } from './RecentActivityItem';
import { LiveConsoleView } from './LiveConsoleView';
import { JobDetailDialog } from '@/components/jobs/JobDetailDialog';
import { CommandDetailDialog } from '@/components/activity/CommandDetailDialog';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { Database } from '@/integrations/supabase/types';

type Job = Database['public']['Tables']['jobs']['Row'];
type IdracCommand = Database['public']['Tables']['idrac_commands']['Row'];

export function NotificationCenter() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [selectedCommand, setSelectedCommand] = useState<IdracCommand | null>(null);
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const [commandDialogOpen, setCommandDialogOpen] = useState(false);
  
  const {
    activeJobs,
    recentCommands,
    jobProgress,
    unreadCount,
    settings,
  } = useNotificationCenter();

  if (!settings.enabled) return null;

  const handleJobClick = (job: Job) => {
    setSelectedJob(job);
    setJobDialogOpen(true);
    setOpen(false);
  };

  const handleCommandClick = (command: IdracCommand) => {
    setSelectedCommand(command);
    setCommandDialogOpen(true);
    setOpen(false);
  };

  const handleViewAllJobs = () => {
    navigate('/jobs');
    setOpen(false);
  };

  const handleViewActivity = () => {
    navigate('/activity');
    setOpen(false);
  };

  const hasFailures = recentCommands.some(cmd => !cmd.success);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label="Notifications"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <Badge
                variant={hasFailures ? 'destructive' : 'default'}
                className={cn(
                  "absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-xs",
                  activeJobs.length > 0 && "animate-pulse"
                )}
              >
                {unreadCount}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        
        <PopoverContent className="w-96 p-0" align="end">
          <div className="flex items-center justify-between p-4 border-b">
            <h3 className="font-semibold">Notifications</h3>
            <div className="flex items-center gap-2">
              {activeJobs.length > 0 && (
                <Badge variant="outline" className="text-xs">
                  {activeJobs.length} active
                </Badge>
              )}
            </div>
          </div>
          
          <Tabs defaultValue="active" className="w-full">
            <TabsList className="w-full grid grid-cols-2 rounded-none border-b">
              <TabsTrigger value="active" className="rounded-none">
                <Clock className="h-4 w-4 mr-2" />
                Active
                {activeJobs.length > 0 && (
                  <Badge variant="secondary" className="ml-2 text-xs">
                    {activeJobs.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="recent" className="rounded-none">
                <Activity className="h-4 w-4 mr-2" />
                Recent
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="active" className="m-0">
              <ScrollArea className="h-96">
                <div className="p-4 space-y-3">
                  {activeJobs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <Clock className="h-12 w-12 text-muted-foreground/50 mb-3" />
                      <p className="text-sm text-muted-foreground">
                        No active operations
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Jobs will appear here when running
                      </p>
                    </div>
                  ) : (
                    activeJobs.map((job) => (
                      <ActiveJobCard
                        key={job.id}
                        job={job}
                        progress={jobProgress.get(job.id)}
                        onClick={() => handleJobClick(job)}
                      />
                    ))
                  )}
                </div>
              </ScrollArea>
              
              {activeJobs.length > 0 && (
                <>
                  <Separator />
                  <div className="p-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-between"
                      onClick={handleViewAllJobs}
                    >
                      View all jobs
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  </div>
                </>
              )}
            </TabsContent>
            
            <TabsContent value="recent" className="m-0">
              <ScrollArea className="h-96">
                <div className="p-4 space-y-2">
                  {recentCommands.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <Activity className="h-12 w-12 text-muted-foreground/50 mb-3" />
                      <p className="text-sm text-muted-foreground">
                        No recent activity
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        iDRAC commands will appear here
                      </p>
                    </div>
                  ) : (
                    recentCommands.map((command) => (
                      <RecentActivityItem
                        key={command.id}
                        command={command}
                        onClick={() => handleCommandClick(command)}
                      />
                    ))
                  )}
                </div>
              </ScrollArea>
              
              {recentCommands.length > 0 && (
                <>
                  <Separator />
                  <div className="p-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-between"
                      onClick={handleViewActivity}
                    >
                      View activity monitor
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="console" className="p-0 m-0">
              <LiveConsoleView />
            </TabsContent>
          </Tabs>
        </PopoverContent>
      </Popover>

      {selectedJob && (
        <JobDetailDialog
          job={selectedJob}
          open={jobDialogOpen}
          onOpenChange={setJobDialogOpen}
        />
      )}

      {selectedCommand && (
        <CommandDetailDialog
          command={selectedCommand}
          open={commandDialogOpen}
          onOpenChange={setCommandDialogOpen}
        />
      )}
    </>
  );
}
