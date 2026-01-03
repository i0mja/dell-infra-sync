import { ReactNode, useState } from "react";
import { ChevronDown, ChevronRight, LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface CollapsibleSectionProps {
  icon: LucideIcon;
  title: string;
  count?: number | string;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

export function CollapsibleSection({
  icon: Icon,
  title,
  count,
  defaultOpen = true,
  children,
  className,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={cn("", className)}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full py-2 text-sm font-medium hover:text-foreground transition-colors"
      >
        <div className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <Icon className="h-4 w-4" />
          <span>{title}</span>
        </div>
        {count !== undefined && (
          <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5">
            {count}
          </Badge>
        )}
      </button>
      {isOpen && <div className="pl-6 pb-3">{children}</div>}
    </div>
  );
}
