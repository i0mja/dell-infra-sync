import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGlobalSearchContext } from "@/contexts/GlobalSearchContext";
import { cn } from "@/lib/utils";

interface SearchTriggerProps {
  className?: string;
  compact?: boolean;
}

export function SearchTrigger({ className, compact = false }: SearchTriggerProps) {
  const { openSearch } = useGlobalSearchContext();

  if (compact) {
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={openSearch}
        className={cn("h-8 w-8", className)}
        title="Search (⌘K)"
      >
        <Search className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      onClick={openSearch}
      className={cn(
        "relative h-9 w-full justify-start rounded-md bg-muted/50 text-sm text-muted-foreground hover:bg-muted hover:text-foreground sm:w-64",
        className
      )}
    >
      <Search className="mr-2 h-4 w-4" />
      <span className="hidden sm:inline-flex">Search...</span>
      <span className="sm:hidden">Search</span>
      <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 hidden h-5 select-none items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
        <span className="text-xs">⌘</span>K
      </kbd>
    </Button>
  );
}
