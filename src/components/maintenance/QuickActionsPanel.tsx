import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Zap, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface QuickActionsPanelProps {
  clusters: string[];
  onUpdateWizard: () => void;
}

export function QuickActionsPanel({ clusters, onUpdateWizard }: QuickActionsPanelProps) {
  const runSafetyCheck = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.functions.invoke('create-job', {
        body: {
          job_type: 'cluster_safety_check',
          created_by: user.id,
          target_scope: { type: 'all_clusters', clusters }
        }
      });

      if (error) throw error;
      // Job created - NotificationContext will show toast
    } catch (error: any) {
      toast.error("Error", { description: error.message });
    }
  };

  const syncVCenters = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.functions.invoke('create-job', {
        body: {
          job_type: 'vcenter_sync',
          created_by: user.id,
          target_scope: { type: 'all' }
        }
      });

      if (error) throw error;
      // Job created - NotificationContext will show toast
    } catch (error: any) {
      toast.error("Error", { description: error.message });
    }
  };

  const runDiscovery = async () => {
    toast.info("Discovery scan", { 
      description: "Please configure discovery settings in the Servers page" 
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Button variant="outline" size="sm" onClick={runSafetyCheck} className="justify-start">
            <Shield className="mr-2 h-4 w-4" />
            Safety Check
          </Button>
          <Button variant="outline" size="sm" onClick={onUpdateWizard} className="justify-start">
            <Zap className="mr-2 h-4 w-4" />
            Update Wizard
          </Button>
          <Button variant="outline" size="sm" onClick={syncVCenters} className="justify-start">
            <RefreshCw className="mr-2 h-4 w-4" />
            Sync vCenters
          </Button>
          <Button variant="outline" size="sm" onClick={runDiscovery} className="justify-start">
            <Search className="mr-2 h-4 w-4" />
            Discovery Scan
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
