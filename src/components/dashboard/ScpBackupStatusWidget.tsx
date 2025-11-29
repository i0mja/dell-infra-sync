import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Database, CheckCircle2, AlertCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";

export const ScpBackupStatusWidget = () => {
  const { data: backups, isLoading } = useQuery({
    queryKey: ['recent-scp-backups'],
    queryFn: async () => {
      const { data } = await supabase
        .from('scp_backups')
        .select('*, servers!inner(hostname, ip_address)')
        .order('exported_at', { ascending: false })
        .limit(10);
      return data || [];
    }
  });

  const validBackups = backups?.filter(b => b.is_valid) || [];
  const recentBackups = backups?.slice(0, 5) || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" />
          SCP Backup Status
        </CardTitle>
        <CardDescription>
          Server Configuration Profile backups
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
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="text-sm text-muted-foreground">Total Backups</div>
                <div className="text-2xl font-bold">{backups?.length || 0}</div>
              </div>
              <div className="p-3 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded-lg">
                <div className="text-sm text-muted-foreground">Valid</div>
                <div className="text-2xl font-bold">{validBackups.length}</div>
              </div>
            </div>

            {recentBackups.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium">Recent Backups</div>
                {recentBackups.map((backup: any) => (
                  <div key={backup.id} className="p-2 bg-muted/50 rounded text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {backup.servers?.hostname || backup.servers?.ip_address}
                      </span>
                      {backup.is_valid ? (
                        <CheckCircle2 className="h-3 w-3 text-green-600" />
                      ) : (
                        <AlertCircle className="h-3 w-3 text-destructive" />
                      )}
                    </div>
                    <div className="text-muted-foreground">{backup.backup_name}</div>
                    {backup.exported_at && (
                      <div className="text-muted-foreground">
                        {formatDistanceToNow(new Date(backup.exported_at), { addSuffix: true })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {backups?.length === 0 && (
              <div className="text-sm text-muted-foreground">
                No SCP backups created yet
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
