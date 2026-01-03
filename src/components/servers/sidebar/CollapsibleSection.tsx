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
        className="flex items-center justify-between w-full py-1.5 text-xs font-medium hover:text-foreground transition-colors"
      >
        <div className="flex items-center gap-1.5">
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <Icon className="h-3.5 w-3.5" />
          <span>{title}</span>
        </div>
        {count !== undefined && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
            {count}
          </Badge>
        )}
      </button>
      {isOpen && <div className="pl-5 pb-2 pt-1">{children}</div>}
    </div>
  );
}
