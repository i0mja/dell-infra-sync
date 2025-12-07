import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ChevronDown, ChevronUp, Clock, RotateCcw, XCircle } from "lucide-react";
import { differenceInDays, format } from "date-fns";

interface SshKey {
  id: string;
  name: string;
  status: string;
  expires_at: string | null;
}

interface ExpiringKey extends SshKey {
  daysUntilExpiry: number;
  urgency: "critical" | "warning" | "info";
}

interface SshKeyExpirationAlertsProps {
  keys: SshKey[];
  onRotate?: (key: SshKey) => void;
  onRevoke?: (key: SshKey) => void;
}

export function SshKeyExpirationAlerts({ keys, onRotate, onRevoke }: SshKeyExpirationAlertsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expiringKeys, setExpiringKeys] = useState<ExpiringKey[]>([]);

  useEffect(() => {
    const now = new Date();
    const expiring = keys
      .filter(k => k.status === "active" && k.expires_at)
      .map(k => {
        const daysUntilExpiry = differenceInDays(new Date(k.expires_at!), now);
        let urgency: ExpiringKey["urgency"] = "info";
        if (daysUntilExpiry <= 7) urgency = "critical";
        else if (daysUntilExpiry <= 30) urgency = "warning";
        return { ...k, daysUntilExpiry, urgency };
      })
      .filter(k => k.daysUntilExpiry <= 90)
      .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

    setExpiringKeys(expiring);
  }, [keys]);

  if (expiringKeys.length === 0) return null;

  const criticalCount = expiringKeys.filter(k => k.urgency === "critical").length;
  const warningCount = expiringKeys.filter(k => k.urgency === "warning").length;

  const getUrgencyColor = (urgency: ExpiringKey["urgency"]) => {
    switch (urgency) {
      case "critical": return "text-destructive";
      case "warning": return "text-amber-500";
      default: return "text-muted-foreground";
    }
  };

  return (
    <div className={`border-l-4 ${criticalCount > 0 ? 'border-l-destructive bg-destructive/5' : 'border-l-amber-500 bg-amber-500/5'} rounded-r-md px-3 py-2`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <AlertTriangle className={`h-4 w-4 ${criticalCount > 0 ? 'text-destructive' : 'text-amber-500'}`} />
          <span className="font-medium">{expiringKeys.length} key(s) expiring</span>
          {criticalCount > 0 && <Badge variant="destructive" className="h-5 text-xs">{criticalCount} critical</Badge>}
          {warningCount > 0 && <Badge variant="secondary" className="h-5 text-xs">{warningCount} warning</Badge>}
        </div>
        <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setIsExpanded(!isExpanded)}>
          {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </Button>
      </div>

      {isExpanded && (
        <div className="mt-2 space-y-1.5 border-t pt-2">
          {expiringKeys.map((key) => (
            <div key={key.id} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Clock className={`h-3 w-3 ${getUrgencyColor(key.urgency)}`} />
                <span className="font-medium">{key.name}</span>
                <span className={`text-xs ${getUrgencyColor(key.urgency)}`}>
                  {key.daysUntilExpiry <= 0 ? "Expired!" : `${key.daysUntilExpiry}d left`}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {onRotate && (
                  <Button variant="ghost" size="sm" onClick={() => onRotate(key)} className="h-6 px-2 text-xs">
                    <RotateCcw className="h-3 w-3 mr-1" />Rotate
                  </Button>
                )}
                {onRevoke && (
                  <Button variant="ghost" size="sm" onClick={() => onRevoke(key)} className="h-6 px-2 text-xs text-destructive hover:text-destructive">
                    <XCircle className="h-3 w-3 mr-1" />Revoke
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
