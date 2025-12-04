import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Zap, Search, RefreshCw, FileBarChart, Server } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { useState } from "react";

export const QuickActionsWidget = () => {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [isCreatingJob, setIsCreatingJob] = useState<string | null>(null);

  const createJob = async (jobType: string, label: string) => {
    if (!session?.user?.id) {
      toast.error("You must be logged in to create jobs");
      return;
    }

    setIsCreatingJob(jobType);
    try {
      const { error } = await supabase.from('jobs').insert({
        job_type: jobType as any,
        created_by: session.user.id,
        status: 'pending',
        target_scope: {}
      });

      if (error) throw error;
      toast.success(`${label} job created`);
    } catch (err) {
      console.error('Failed to create job:', err);
      toast.error(`Failed to create ${label.toLowerCase()} job`);
    } finally {
      setIsCreatingJob(null);
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
      onClick: () => createJob('vcenter_sync', 'vCenter Sync')
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
            const isLoading = isCreatingJob === action.label;
            
            return (
              <Button
                key={action.label}
                variant="outline"
                className="h-auto py-3 px-3 flex flex-col items-center gap-1 text-center"
                onClick={action.onClick}
                disabled={isLoading}
              >
                <Icon className="h-5 w-5" />
                <span className="text-xs font-medium">{action.label}</span>
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
