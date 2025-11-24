import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow, isBefore, subHours } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle, ArrowRight, CheckCircle2, Clock, Cloud, Network, Server } from "lucide-react";

type JobStatus = Database["public"]["Enums"]["job_status"];
type ServerRow = Pick<
  Database["public"]["Tables"]["servers"]["Row"],
  | "id"
  | "hostname"
  | "ip_address"
  | "overall_health"
  | "connection_status"
  | "connection_error"
  | "last_health_check"
  | "last_openmanage_sync"
  | "last_seen"
  | "product_name"
  | "service_tag"
  | "idrac_firmware"
>;

type JobRow = Pick<
  Database["public"]["Tables"]["jobs"]["Row"],
  "id" | "job_type" | "status" | "created_at" | "started_at" | "completed_at"
>;

const statusStyles: Record<JobStatus, string> = {
  pending: "bg-amber-50 text-amber-700 border border-amber-100",
  running: "bg-blue-50 text-blue-700 border border-blue-100",
  completed: "bg-emerald-50 text-emerald-700 border border-emerald-100",
  failed: "bg-red-50 text-red-700 border border-red-100",
  cancelled: "bg-slate-50 text-slate-700 border border-slate-100",
};

const formatRelativeTime = (timestamp?: string | null) => {
  if (!timestamp) return "Not available";

  try {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  } catch (error) {
    console.error("Failed to format date", error);
    return "Unknown";
  }
};

const DashboardStat = ({
  title,
  description,
  value,
  icon: Icon,
  loading,
}: {
  title: string;
  description: string;
  value: string | number;
  icon: typeof Server;
  loading: boolean;
}) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium">{title}</CardTitle>
      <Icon className="h-4 w-4 text-primary" />
    </CardHeader>
    <CardContent>
      {loading ? (
        <Skeleton className="h-8 w-20" />
      ) : (
        <>
          <div className="text-2xl font-bold">{value}</div>
          <p className="text-xs text-muted-foreground">{description}</p>
        </>
      )}
    </CardContent>
  </Card>
);

const Dashboard = () => {
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [vcenterHostCount, setVcenterHostCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const [serverResponse, jobsResponse, vcenterResponse] = await Promise.all([
          supabase
            .from("servers")
            .select(
              "id, hostname, ip_address, overall_health, connection_status, connection_error, last_health_check, last_openmanage_sync, last_seen, product_name, service_tag, idrac_firmware"
            )
            .order("updated_at", { ascending: false }),
          supabase
            .from("jobs")
            .select("id, job_type, status, created_at, started_at, completed_at")
            .order("created_at", { ascending: false })
            .limit(10),
          supabase.from("vcenter_hosts").select("*", { count: "exact", head: true }),
        ]);

        if (serverResponse.error) throw serverResponse.error;
        if (jobsResponse.error) throw jobsResponse.error;
        if (vcenterResponse.error) throw vcenterResponse.error;

        setServers(serverResponse.data || []);
        setJobs(jobsResponse.data || []);
        setVcenterHostCount(vcenterResponse.count || 0);
      } catch (fetchError) {
        console.error("Error fetching dashboard data", fetchError);
        setError("Unable to load dashboard data right now.");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const activeJobsCount = useMemo(
    () => jobs.filter((job) => job.status === "pending" || job.status === "running").length,
    [jobs]
  );

  const serversNeedingAttention = useMemo(
    () =>
      servers.filter(
        (server) =>
          server.connection_error ||
          server.connection_status === "error" ||
          server.connection_status === "unreachable" ||
          server.overall_health?.toLowerCase() === "critical"
      ),
    [servers]
  );

  const healthyServerCount = useMemo(
    () =>
      servers.filter((server) => {
        const health = server.overall_health?.toLowerCase();
        return health === "ok" || health === "healthy";
      }).length,
    [servers]
  );

  const readinessPercent = useMemo(() => {
    if (servers.length === 0) return 0;
    return Math.round((healthyServerCount / servers.length) * 100);
  }, [healthyServerCount, servers.length]);

  const staleHealthChecks = useMemo(
    () =>
      servers.filter((server) => {
        if (!server.last_health_check) return true;
        return isBefore(new Date(server.last_health_check), subHours(new Date(), 24));
      }),
    [servers]
  );

  const firmwareUnknown = useMemo(() => servers.filter((server) => !server.idrac_firmware), [servers]);

  const recentUpdateJobs = useMemo(() => {
    const firmwareJobs = jobs.filter(
      (job) => job.job_type === "firmware_update" || job.job_type === "full_server_update"
    );

    if (firmwareJobs.length > 0) return firmwareJobs.slice(0, 5);
    return jobs.slice(0, 5);
  }, [jobs]);

  const lastHealthCheck = useMemo(() => {
    const timestamps = servers
      .map((server) => server.last_health_check)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

    return timestamps[0];
  }, [servers]);

  const lastOpenManageSync = useMemo(() => {
    const timestamps = servers
      .map((server) => server.last_openmanage_sync)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

    return timestamps[0];
  }, [servers]);

  const renderJobStatus = (status: JobStatus) => (
    <Badge className={`${statusStyles[status]} capitalize`} variant="outline">
      {status}
    </Badge>
  );

  return (
    <div className="container mx-auto p-6 space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">Dell Updater Overview</h1>
        <p className="text-muted-foreground max-w-3xl">
          Stay focused on firmware and lifecycle operations. This view highlights the servers, jobs, and
          sync signals that matter most for keeping your Dell environment current.
        </p>
      </div>

      {error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <CardTitle className="text-destructive">{error}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground">
            Please verify your Supabase connection or try again shortly.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DashboardStat
          title="Managed servers"
          description="Discovered via iDRAC"
          value={servers.length}
          icon={Server}
          loading={loading}
        />
        <DashboardStat
          title="vCenter hosts"
          description="Linked ESXi inventory"
          value={vcenterHostCount}
          icon={Cloud}
          loading={loading}
        />
        <DashboardStat
          title="Active jobs"
          description="Pending or running tasks"
          value={activeJobsCount}
          icon={Clock}
          loading={loading}
        />
        <DashboardStat
          title="Needs attention"
          description="Connectivity or health issues"
          value={serversNeedingAttention.length}
          icon={AlertCircle}
          loading={loading}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Update readiness</CardTitle>
                <CardDescription>
                  Overall fleet readiness based on current health, reachability, and telemetry freshness.
                </CardDescription>
              </div>
              <Badge variant="secondary" className="text-sm">
                {servers.length > 0 ? `${readinessPercent}% ready` : "No servers yet"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Healthy and reachable</span>
                  <span>
                    {healthyServerCount} of {servers.length || "-"}
                  </span>
                </div>
              <Progress value={readinessPercent} />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-lg border bg-muted/40 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Ready for maintenance
                </div>
                <p className="mt-2 text-2xl font-semibold">{healthyServerCount}</p>
                <p className="text-xs text-muted-foreground">Servers reporting OK or Healthy</p>
              </div>
              <div className="rounded-lg border bg-muted/40 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Network className="h-4 w-4 text-amber-600" />
                  Connectivity issues
                </div>
                <p className="mt-2 text-2xl font-semibold">{serversNeedingAttention.length}</p>
                <p className="text-xs text-muted-foreground">Check credentials, reachability, or health</p>
              </div>
              <div className="rounded-lg border bg-muted/40 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <AlertCircle className="h-4 w-4 text-sky-700" />
                  Stale telemetry
                </div>
                <p className="mt-2 text-2xl font-semibold">{staleHealthChecks.length}</p>
                <p className="text-xs text-muted-foreground">Health checks older than 24 hours</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick actions</CardTitle>
            <CardDescription>Jump straight to the workflows you need most.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="secondary" className="w-full justify-between" asChild>
              <Link to="/servers">
                Review servers
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button variant="secondary" className="w-full justify-between" asChild>
              <Link to="/maintenance-planner">
                Plan maintenance window
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button variant="secondary" className="w-full justify-between" asChild>
              <Link to="/vcenter">
                Sync vCenter inventory
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button variant="secondary" className="w-full justify-between" asChild>
              <Link to="/activity">
                View activity log
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent update jobs</CardTitle>
            <CardDescription>Latest firmware and lifecycle tasks across the fleet.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : recentUpdateJobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No jobs have been created yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentUpdateJobs.map((job) => {
                    const durationMinutes =
                      job.started_at && job.completed_at
                        ? Math.max(
                            1,
                            Math.round(
                              (new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) /
                                60000
                            )
                          )
                        : null;

                    return (
                      <TableRow key={job.id}>
                        <TableCell className="font-medium">
                          {job.job_type.replace(/_/g, " ")}
                        </TableCell>
                        <TableCell>{renderJobStatus(job.status)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatRelativeTime(job.created_at)}
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {durationMinutes ? `${durationMinutes} min` : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Attention required</CardTitle>
            <CardDescription>Servers that are unreachable, unhealthy, or missing details.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : serversNeedingAttention.length === 0 ? (
              <p className="text-sm text-muted-foreground">All servers look good right now.</p>
            ) : (
              <div className="space-y-3">
                {serversNeedingAttention.slice(0, 5).map((server) => (
                  <div key={server.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{server.hostname || server.ip_address}</p>
                        <p className="text-xs text-muted-foreground">{server.product_name || "Unknown model"}</p>
                      </div>
                      <Badge variant="destructive">Check</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {server.connection_error || server.connection_status || "Needs review"}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {firmwareUnknown.length > 0 && (
              <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
                {firmwareUnknown.length} server(s) are missing iDRAC firmware details. Run a discovery or health
                check to refresh inventory.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Health telemetry</CardTitle>
            <CardDescription>Latest health check across the fleet.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>Last health check</span>
              <span className="font-medium text-foreground">{formatRelativeTime(lastHealthCheck)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Stale checks</span>
              <Badge variant="outline">{staleHealthChecks.length}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>OpenManage sync</CardTitle>
            <CardDescription>Latest inventory sync signals.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>Last sync</span>
              <span className="font-medium text-foreground">{formatRelativeTime(lastOpenManageSync)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Servers without firmware info</span>
              <Badge variant="outline">{firmwareUnknown.length}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active signals</CardTitle>
            <CardDescription>Track live connections and discoveries.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>Reachable servers</span>
              <span className="font-medium text-foreground">{servers.length - serversNeedingAttention.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Last seen update</span>
              <span className="font-medium text-foreground">{formatRelativeTime(servers[0]?.last_seen)}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
