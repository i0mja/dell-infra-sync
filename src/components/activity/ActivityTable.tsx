import { format } from "date-fns";
import { CheckCircle2, XCircle, Folder, Monitor, Server, Database, Users, Cpu } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface UserActivity {
  id: string;
  timestamp: string;
  activity_type: string;
  target_type: string | null;
  target_name: string | null;
  details: unknown;
  success: boolean;
  duration_ms: number | null;
  error_message: string | null;
  user_id: string | null;
  profiles?: { email: string; full_name: string | null } | null;
}

interface ActivityTableProps {
  activities: UserActivity[];
  isLoading: boolean;
}

const activityTypeLabels: Record<string, string> = {
  datastore_browse: "Browsed Datastore",
  connectivity_test: "Connectivity Test",
  console_launch: "Launched Console",
  health_check: "Health Check",
  power_action: "Power Action",
  virtual_media_mount: "Mounted Virtual Media",
  virtual_media_unmount: "Unmounted Virtual Media",
  event_log_fetch: "Fetched Event Logs",
  credential_test: "Tested Credentials",
  idm_login: "IDM Login",
  scp_preview: "Previewed SCP Backup",
  bios_fetch: "Fetched BIOS Config",
};

const targetTypeIcons: Record<string, React.ReactNode> = {
  server: <Server className="h-4 w-4" />,
  vcenter: <Monitor className="h-4 w-4" />,
  datastore: <Database className="h-4 w-4" />,
  idm: <Users className="h-4 w-4" />,
  cluster: <Cpu className="h-4 w-4" />,
};

export function ActivityTable({ activities, isLoading }: ActivityTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Folder className="h-12 w-12 mb-4 opacity-50" />
        <p>No activity logs found</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[180px]">Time</TableHead>
            <TableHead>Activity</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>User</TableHead>
            <TableHead className="text-right">Duration</TableHead>
            <TableHead className="w-[100px]">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {activities.map((activity) => (
            <TableRow key={activity.id}>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {format(new Date(activity.timestamp), "MMM d, HH:mm:ss")}
              </TableCell>
              <TableCell>
                <span className="font-medium">
                  {activityTypeLabels[activity.activity_type] || activity.activity_type}
                </span>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  {activity.target_type && targetTypeIcons[activity.target_type]}
                  <span className="text-sm">{activity.target_name || "-"}</span>
                </div>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {activity.profiles?.full_name || activity.profiles?.email || "-"}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {activity.duration_ms ? `${activity.duration_ms}ms` : "-"}
              </TableCell>
              <TableCell>
                {activity.success ? (
                  <Badge variant="outline" className="text-green-600 border-green-600/30 bg-green-600/10">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Success
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-red-600 border-red-600/30 bg-red-600/10">
                    <XCircle className="h-3 w-3 mr-1" />
                    Failed
                  </Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
