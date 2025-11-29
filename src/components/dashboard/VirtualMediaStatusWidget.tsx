import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Disc3, CheckCircle2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";

export const VirtualMediaStatusWidget = () => {
  const { data: sessions, isLoading } = useQuery({
    queryKey: ['virtual-media-sessions'],
    queryFn: async () => {
      const { data } = await supabase
        .from('virtual_media_sessions')
        .select('*, servers!inner(hostname, ip_address)')
        .eq('is_mounted', true)
        .order('mounted_at', { ascending: false });
      return data || [];
    },
    refetchInterval: 30000 // Refresh every 30s
  });

  const activeSessions = sessions || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Disc3 className="h-5 w-5 text-primary" />
          Virtual Media Status
        </CardTitle>
        <CardDescription>
          Currently mounted ISO/virtual media
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="text-sm text-muted-foreground">Active Mounts</div>
              <div className="text-2xl font-bold">{activeSessions.length}</div>
            </div>

            {activeSessions.length > 0 ? (
              <div className="space-y-2">
                <div className="text-sm font-medium">Mounted Media</div>
                {activeSessions.slice(0, 5).map((session: any) => (
                  <div key={session.id} className="p-2 bg-muted/50 rounded text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {session.servers?.hostname || session.servers?.ip_address}
                      </span>
                      <Badge variant="secondary" className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Mounted
                      </Badge>
                    </div>
                    <div className="text-muted-foreground truncate">
                      {session.image_name}
                    </div>
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="text-xs">
                        {session.media_type}
                      </Badge>
                      {session.mounted_at && (
                        <span className="text-muted-foreground">
                          {formatDistanceToNow(new Date(session.mounted_at), { addSuffix: true })}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                No virtual media currently mounted
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
