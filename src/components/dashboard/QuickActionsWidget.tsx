import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Zap, Search, RefreshCw, FileBarChart, Server } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { triggerVCenterSync } from "@/services/vcenterService";
import { toast } from "sonner";
import { useState } from "react";

export const QuickActionsWidget = () => {
  const navigate = useNavigate();
  const [isSyncing, setIsSyncing] = useState(false);

  const handleVCenterSync = async () => {
    setIsSyncing(true);
    try {
      const result = await triggerVCenterSync();
      
      // If result is a string, it's a job ID (fallback occurred)
      if (typeof result === 'string') {
        toast.success('vCenter sync started', {
          description: 'Sync job queued',
          action: {
            label: 'View Jobs',
            onClick: () => navigate('/maintenance-planner?tab=jobs')
          }
        });
      } else if (result.success) {
        toast.success('vCenter sync completed', {
          description: result.message || 'vCenter data synced successfully'
        });
      } else {
        throw new Error(result.error || 'Sync failed');
      }
    } catch (err) {
      console.error('Failed to sync vCenter:', err);
      toast.error('vCenter sync failed', {
        description: err instanceof Error ? err.message : 'Unknown error'
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const actions = [
    {
      icon: Search,
      label: 'Run Discovery',
      description: 'Scan network for servers',
      onClick: () => navigate('/servers', { state: { openDiscovery: true } })
    },
    {
      icon: RefreshCw,
      label: 'Sync vCenter',
      description: 'Update vCenter data',
      onClick: handleVCenterSync,
      loading: isSyncing
    },
    {
      icon: Server,
      label: 'View Servers',
      description: 'Manage server inventory',
      onClick: () => navigate('/servers')
    },
    {
      icon: FileBarChart,
      label: 'View Reports',
      description: 'Fleet analytics',
      onClick: () => navigate('/reports')
    }
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="h-4 w-4" />
          Quick Actions
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2">
          {actions.map(action => {
            const Icon = action.icon;
            const isLoading = 'loading' in action && action.loading;
            
            return (
              <Button
                key={action.label}
                variant="outline"
                className="h-auto py-3 px-3 flex flex-col items-center gap-1 text-center"
                onClick={action.onClick}
                disabled={isLoading}
              >
                <Icon className={`h-5 w-5 ${isLoading ? 'animate-spin' : ''}`} />
                <span className="text-xs font-medium">{action.label}</span>
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
