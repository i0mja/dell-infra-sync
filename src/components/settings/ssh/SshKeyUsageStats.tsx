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
    usedLast7d: keys.filter(k => {
      if (!k.last_used_at) return false;
      return differenceInDays(now, new Date(k.last_used_at)) < 7;
    }).length,
    neverUsed: keys.filter(k => k.status === "active" && !k.last_used_at).length,
    totalUses: keys.reduce((sum, k) => sum + (k.use_count || 0), 0),
  };

  // Get top 3 used keys
  const topKeys = [...keys]
    .filter(k => k.status === "active" && k.use_count && k.use_count > 0)
    .sort((a, b) => (b.use_count || 0) - (a.use_count || 0))
    .slice(0, 3);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <Key className="h-3.5 w-3.5" />
        <span><strong className="text-foreground">{stats.total}</strong> keys</span>
        <span className="text-xs">({stats.active} active{stats.pending > 0 && `, ${stats.pending} pending`})</span>
      </div>
      
      <span className="text-border">|</span>
      
      <div className="flex items-center gap-1.5">
        <Server className="h-3.5 w-3.5" />
        <span><strong className="text-foreground">{stats.totalUses}</strong> total uses</span>
      </div>
      
      <span className="text-border">|</span>
      
      <div className="flex items-center gap-1.5">
        <TrendingUp className="h-3.5 w-3.5" />
        <span><strong className="text-foreground">{stats.usedLast7d}</strong> used (7d)</span>
      </div>

      {stats.neverUsed > 0 && (
        <>
          <span className="text-border">|</span>
          <div className="flex items-center gap-1.5 text-amber-500">
            <Clock className="h-3.5 w-3.5" />
            <span>{stats.neverUsed} never used</span>
          </div>
        </>
      )}

      {topKeys.length > 0 && (
        <>
          <span className="text-border">|</span>
          <div className="flex items-center gap-1.5">
            <span className="text-xs">Top:</span>
            {topKeys.map((key, idx) => (
              <Badge key={key.id} variant="outline" className="h-5 text-xs font-normal">
                {key.name} ({key.use_count})
              </Badge>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
