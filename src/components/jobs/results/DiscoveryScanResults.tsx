import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Server, Network, KeyRound, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface DiscoveryScanResultsProps {
  details: any;
}

export const DiscoveryScanResults = ({ details }: DiscoveryScanResultsProps) => {
  const discovered = details?.discovered_count || details?.total_discovered || 0;
  const scanned = details?.scanned_ips || details?.ip_count || 0;
  const authFailures = details?.auth_failures || details?.failed_count || 0;
  const duration = details?.scan_duration_seconds || 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Server className="h-4 w-4" />
              Discovered
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">{discovered}</div>
            <p className="text-xs text-muted-foreground mt-1">New servers found</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Network className="h-4 w-4" />
              Scanned
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{scanned}</div>
            <p className="text-xs text-muted-foreground mt-1">IPs checked</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              Auth Failures
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{authFailures}</div>
            <p className="text-xs text-muted-foreground mt-1">Failed logins</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Duration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{duration}s</div>
            <p className="text-xs text-muted-foreground mt-1">Scan time</p>
          </CardContent>
        </Card>
      </div>

      {details?.ip_ranges && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Scanned Ranges</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {details.ip_ranges.map((range: string, idx: number) => (
                <Badge key={idx} variant="outline">{range}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
