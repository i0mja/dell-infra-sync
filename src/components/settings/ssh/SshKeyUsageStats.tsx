import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Key, TrendingUp, Clock, Server } from "lucide-react";
import { differenceInDays } from "date-fns";

interface SshKey {
  id: string;
  name: string;
  status: string;
  use_count: number | null;
  last_used_at: string | null;
  created_at: string;
}

interface SshKeyUsageStatsProps {
  keys: SshKey[];
}

export function SshKeyUsageStats({ keys }: SshKeyUsageStatsProps) {
  const now = new Date();
  
  const stats = {
    total: keys.length,
    active: keys.filter(k => k.status === "active").length,
    pending: keys.filter(k => k.status === "pending").length,
    revoked: keys.filter(k => k.status === "revoked").length,
    usedLast24h: keys.filter(k => {
      if (!k.last_used_at) return false;
      return differenceInDays(now, new Date(k.last_used_at)) < 1;
    }).length,
    usedLast7d: keys.filter(k => {
      if (!k.last_used_at) return false;
      return differenceInDays(now, new Date(k.last_used_at)) < 7;
    }).length,
    usedLast30d: keys.filter(k => {
      if (!k.last_used_at) return false;
      return differenceInDays(now, new Date(k.last_used_at)) < 30;
    }).length,
    neverUsed: keys.filter(k => k.status === "active" && !k.last_used_at).length,
    totalUses: keys.reduce((sum, k) => sum + (k.use_count || 0), 0),
  };

  // Get top used keys
  const topKeys = [...keys]
    .filter(k => k.status === "active" && k.use_count && k.use_count > 0)
    .sort((a, b) => (b.use_count || 0) - (a.use_count || 0))
    .slice(0, 5);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          SSH Key Usage Statistics
        </CardTitle>
        <CardDescription>Overview of key usage patterns</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="space-y-1">
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Key className="h-3 w-3" /> Total Keys
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-bold">{stats.active}</p>
              <span className="text-sm text-muted-foreground">
                / {stats.pending} pending
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Active Keys</p>
          </div>
          <div className="space-y-1">
            <p className="text-2xl font-bold">{stats.totalUses}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Server className="h-3 w-3" /> Total Uses
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-2xl font-bold">{stats.revoked}</p>
            <p className="text-xs text-muted-foreground">Revoked</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-6 p-3 bg-muted/50 rounded-lg">
          <div className="text-center">
            <p className="text-lg font-semibold">{stats.usedLast24h}</p>
            <p className="text-xs text-muted-foreground">Used (24h)</p>
          </div>
          <div className="text-center border-x">
            <p className="text-lg font-semibold">{stats.usedLast7d}</p>
            <p className="text-xs text-muted-foreground">Used (7d)</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold">{stats.usedLast30d}</p>
            <p className="text-xs text-muted-foreground">Used (30d)</p>
          </div>
        </div>

        {stats.neverUsed > 0 && (
          <div className="flex items-center gap-2 p-2 bg-amber-500/10 rounded-md mb-4">
            <Clock className="h-4 w-4 text-amber-500" />
            <span className="text-sm">
              <strong>{stats.neverUsed}</strong> active key(s) have never been used
            </span>
          </div>
        )}

        {topKeys.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">Most Used Keys</h4>
            <div className="space-y-2">
              {topKeys.map((key, idx) => (
                <div key={key.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="w-5 h-5 p-0 justify-center">
                      {idx + 1}
                    </Badge>
                    <span className="truncate max-w-[150px]">{key.name}</span>
                  </div>
                  <span className="text-muted-foreground">{key.use_count} uses</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}