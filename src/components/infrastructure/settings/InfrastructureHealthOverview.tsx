import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Disc, 
  Database, 
  HardDrive, 
  Server, 
  Briefcase,
  Plus,
  Upload,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";

interface InfrastructureHealthOverviewProps {
  onNavigateToTab: (tab: string) => void;
  onQuickAction: (action: string) => void;
}

export function InfrastructureHealthOverview({ 
  onNavigateToTab,
  onQuickAction 
}: InfrastructureHealthOverviewProps) {
  // Fetch ISO images count
  const { data: isoImages } = useQuery({
    queryKey: ['iso-images-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('iso_images')
        .select('id, file_size_bytes, upload_status');
      if (error) throw error;
      return data || [];
    }
  });

  // Fetch firmware packages count
  const { data: firmwarePackages } = useQuery({
    queryKey: ['firmware-packages-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('firmware_packages')
        .select('id, file_size_bytes, upload_status');
      if (error) throw error;
      return data || [];
    }
  });

  // Fetch ZFS appliances count
  const { data: zfsTemplates } = useQuery({
    queryKey: ['zfs-templates-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zfs_target_templates')
        .select('id, is_active, status');
      if (error) throw error;
      return data || [];
    }
  });

  // Fetch server groups
  const { data: serverGroups } = useQuery({
    queryKey: ['server-groups-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('server_groups')
        .select('id, name');
      if (error) throw error;
      return data || [];
    }
  });

  // Fetch OpenManage settings
  const { data: omeSettings } = useQuery({
    queryKey: ['openmanage-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('openmanage_settings')
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data;
    }
  });

  // Calculate stats
  const isoCount = isoImages?.filter(i => i.upload_status === 'completed').length || 0;
  const isoTotalSize = isoImages?.reduce((acc, i) => acc + (i.file_size_bytes || 0), 0) || 0;
  
  const firmwareCount = firmwarePackages?.filter(f => f.upload_status === 'completed').length || 0;
  const firmwareTotalSize = firmwarePackages?.reduce((acc, f) => acc + (f.file_size_bytes || 0), 0) || 0;
  
  const zfsReadyCount = zfsTemplates?.filter(z => z.status === 'ready').length || 0;
  const zfsTotalCount = zfsTemplates?.length || 0;
  
  const serverGroupCount = serverGroups?.length || 0;

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getOmeStatus = () => {
    if (!omeSettings?.host) return { status: 'unconfigured', color: 'secondary' as const };
    if (omeSettings?.sync_enabled) return { status: 'connected', color: 'default' as const };
    return { status: 'disabled', color: 'outline' as const };
  };

  const omeStatus = getOmeStatus();

  return (
    <div className="space-y-6">
      {/* Quick Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card 
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => onNavigateToTab('libraries')}
        >
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Disc className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{isoCount}</p>
                <p className="text-xs text-muted-foreground">ISO Images</p>
                <p className="text-xs text-muted-foreground">{formatBytes(isoTotalSize)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card 
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => onNavigateToTab('libraries')}
        >
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10">
                <Database className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{firmwareCount}</p>
                <p className="text-xs text-muted-foreground">Firmware Packages</p>
                <p className="text-xs text-muted-foreground">{formatBytes(firmwareTotalSize)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card 
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => onNavigateToTab('libraries')}
        >
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <HardDrive className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{zfsReadyCount}/{zfsTotalCount}</p>
                <p className="text-xs text-muted-foreground">ZFS Appliances</p>
                <p className="text-xs text-muted-foreground">Ready</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card 
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => onNavigateToTab('server-groups')}
        >
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-500/10">
                <Briefcase className="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{serverGroupCount}</p>
                <p className="text-xs text-muted-foreground">Server Groups</p>
                <p className="text-xs text-muted-foreground">Configured</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card 
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => onNavigateToTab('integrations')}
        >
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-cyan-500/10">
                <Server className="h-5 w-5 text-cyan-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">OpenManage</p>
                  <Badge variant={omeStatus.color} className="text-[10px] px-1.5 py-0">
                    {omeStatus.status}
                  </Badge>
                </div>
                {omeSettings?.last_sync && (
                  <p className="text-xs text-muted-foreground mt-1">
                    <Clock className="h-3 w-3 inline mr-1" />
                    {formatDistanceToNow(new Date(omeSettings.last_sync), { addSuffix: true })}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => onQuickAction('add-iso')}
            >
              <Plus className="h-4 w-4 mr-2" />
              Register ISO
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => onQuickAction('upload-firmware')}
            >
              <Upload className="h-4 w-4 mr-2" />
              Upload Firmware
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => onQuickAction('prepare-appliance')}
            >
              <HardDrive className="h-4 w-4 mr-2" />
              Prepare Appliance
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => onQuickAction('create-group')}
            >
              <Briefcase className="h-4 w-4 mr-2" />
              Create Group
            </Button>
            {omeSettings?.host && (
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => onQuickAction('sync-openmanage')}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Sync OpenManage
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Status Alerts */}
      {(!omeSettings?.host || zfsTotalCount === 0 || isoCount === 0) && (
        <Card className="border-dashed">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Setup Recommendations</p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  {!omeSettings?.host && (
                    <li 
                      className="flex items-center gap-1 cursor-pointer hover:text-foreground"
                      onClick={() => onNavigateToTab('integrations')}
                    >
                      <XCircle className="h-3 w-3 text-destructive" />
                      Configure OpenManage Enterprise to sync servers
                    </li>
                  )}
                  {isoCount === 0 && (
                    <li 
                      className="flex items-center gap-1 cursor-pointer hover:text-foreground"
                      onClick={() => onQuickAction('add-iso')}
                    >
                      <XCircle className="h-3 w-3 text-destructive" />
                      Register ISO images for virtual media boot
                    </li>
                  )}
                  {zfsTotalCount === 0 && (
                    <li 
                      className="flex items-center gap-1 cursor-pointer hover:text-foreground"
                      onClick={() => onQuickAction('prepare-appliance')}
                    >
                      <XCircle className="h-3 w-3 text-destructive" />
                      Prepare ZFS appliances for DR replication
                    </li>
                  )}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
