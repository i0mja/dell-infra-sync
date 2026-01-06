import { useState } from "react";
import { ChevronDown, AlertTriangle } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

type Severity = "ok" | "warning" | "critical";

interface ServerHardwareRowProps {
  icon: LucideIcon;
  iconColor: string;
  value: string;
  issueCount?: number;
  severity?: Severity;
  children?: React.ReactNode;
}

export function ServerHardwareRow({
  icon: Icon,
  iconColor,
  value,
  issueCount = 0,
  severity = "ok",
  children,
}: ServerHardwareRowProps) {
  const [isOpen, setIsOpen] = useState(false);
  const hasIssues = issueCount > 0;
  const isExpandable = hasIssues && children;

  const rowStyles = cn(
    "flex items-center gap-3 py-1.5 px-2 rounded-md transition-all",
    {
      "hover:bg-muted/50": !hasIssues,
      // Warning state
      "bg-warning/10 border-l-2 border-warning hover:bg-warning/15": severity === "warning",
      // Critical state - red glow effect
      "bg-destructive/10 border-l-2 border-destructive hover:bg-destructive/15 shadow-[0_0_8px_rgba(239,68,68,0.3)]": severity === "critical",
      "cursor-pointer": isExpandable,
    }
  );

  const iconStyles = cn("h-4 w-4 flex-shrink-0", {
    [iconColor]: !hasIssues,
    "text-warning": severity === "warning",
    "text-destructive": severity === "critical",
  });

  const content = (
    <div className={rowStyles}>
      <Icon className={iconStyles} />
      <span className="text-sm text-foreground flex-1">{value}</span>
      {hasIssues && (
        <Badge 
          variant={severity === "critical" ? "destructive" : "outline"}
          className={cn("text-xs", {
            "bg-warning/20 text-warning border-warning/30": severity === "warning",
          })}
        >
          <AlertTriangle className="h-3 w-3 mr-1" />
          {issueCount}
        </Badge>
      )}
      {isExpandable && (
        <ChevronDown 
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            isOpen && "rotate-180"
          )} 
        />
      )}
    </div>
  );

  if (!isExpandable) {
    return content;
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        {content}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 ml-7 space-y-1">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
