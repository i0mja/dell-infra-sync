import { ReactNode, useState } from "react";
import { ChevronDown, ChevronRight, LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface CollapsibleSectionProps {
  icon: LucideIcon;
  title: string;
  count?: number | string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
  /** Optional inline content (health badges, etc.) shown before chevron */
  headerContent?: ReactNode;
}

export function CollapsibleSection({
  icon: Icon,
  title,
  count,
  summary,
  defaultOpen = true,
  children,
  className,
  headerContent,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={cn("", className)}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full py-2 px-1 text-xs font-medium hover:bg-muted/50 rounded-sm transition-colors"
      >
        <div className="flex items-center gap-1.5">
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <Icon className="h-3.5 w-3.5" />
          <span>{title}</span>
          {count !== undefined && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
              {count}
            </Badge>
          )}
          {summary && (
            <span className="text-[10px] text-muted-foreground">{summary}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {headerContent}
        </div>
      </button>
      {isOpen && <div className="pl-5 pb-2 pt-1">{children}</div>}
    </div>
  );
}
