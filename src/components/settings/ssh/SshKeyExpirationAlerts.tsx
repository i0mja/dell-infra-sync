import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  const [isOpen, setIsOpen] = useState(true);
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

  const getUrgencyVariant = (urgency: ExpiringKey["urgency"]) => {
    switch (urgency) {
      case "critical": return "destructive";
      case "warning": return "secondary";
      default: return "outline";
    }
  };

  const getUrgencyColor = (urgency: ExpiringKey["urgency"]) => {
    switch (urgency) {
      case "critical": return "text-destructive";
      case "warning": return "text-amber-500";
      default: return "text-muted-foreground";
    }
  };

  return (
    <Alert variant={criticalCount > 0 ? "destructive" : "default"} className="mb-4">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5" />
            <div>
              <AlertTitle className="flex items-center gap-2">
                SSH Keys Expiring Soon
                {criticalCount > 0 && (
                  <Badge variant="destructive">{criticalCount} Critical</Badge>
                )}
                {warningCount > 0 && (
                  <Badge variant="secondary">{warningCount} Warning</Badge>
                )}
              </AlertTitle>
              <AlertDescription className="mt-1">
                {expiringKeys.length} key(s) will expire within the next 90 days
              </AlertDescription>
            </div>
          </div>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm">
              {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent>
          <div className="mt-4 space-y-2 border-t pt-4">
            {expiringKeys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between p-2 rounded-md bg-muted/50"
              >
                <div className="flex items-center gap-3">
                  <Clock className={`h-4 w-4 ${getUrgencyColor(key.urgency)}`} />
                  <div>
                    <p className="text-sm font-medium">{key.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Expires {format(new Date(key.expires_at!), "MMM d, yyyy")}
                      <span className={`ml-2 ${getUrgencyColor(key.urgency)}`}>
                        ({key.daysUntilExpiry <= 0 
                          ? "Expired!" 
                          : `${key.daysUntilExpiry} day${key.daysUntilExpiry === 1 ? "" : "s"} left`})
                      </span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={getUrgencyVariant(key.urgency) as any}>
                    {key.urgency === "critical" ? "Critical" : key.urgency === "warning" ? "Warning" : "Info"}
                  </Badge>
                  {onRotate && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onRotate(key)}
                      className="h-7 px-2"
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />
                      Rotate
                    </Button>
                  )}
                  {onRevoke && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onRevoke(key)}
                      className="h-7 px-2 text-destructive hover:text-destructive"
                    >
                      <XCircle className="h-3 w-3 mr-1" />
                      Revoke
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Alert>
  );
}