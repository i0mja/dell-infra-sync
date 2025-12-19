import { Search, AlertCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchEmptyProps {
  query: string;
}

export function SearchEmpty({ query }: SearchEmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Search className="h-10 w-10 text-muted-foreground/40 mb-3" />
      <p className="text-sm font-medium text-muted-foreground">
        No results for "{query}"
      </p>
      <p className="text-xs text-muted-foreground/60 mt-1 max-w-[200px]">
        Try searching for servers, VMs, networks, or settings
      </p>
    </div>
  );
}

export function SearchError({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <AlertCircle className="h-10 w-10 text-destructive/40 mb-3" />
      <p className="text-sm font-medium text-muted-foreground">
        {message}
      </p>
    </div>
  );
}

export function SearchLoading() {
  return (
    <div className="flex flex-col gap-2 p-2">
      {[1, 2, 3].map(i => (
        <div
          key={i}
          className="flex items-center gap-3 px-3 py-2.5 rounded-md animate-pulse"
        >
          <div className="h-8 w-8 rounded-md bg-muted" />
          <div className="flex-1 space-y-1.5">
            <div className="h-4 w-32 rounded bg-muted" />
            <div className="h-3 w-48 rounded bg-muted/60" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface SearchHintProps {
  className?: string;
}

export function SearchHint({ className }: SearchHintProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-8 text-center", className)}>
      <Clock className="h-8 w-8 text-muted-foreground/30 mb-2" />
      <p className="text-sm text-muted-foreground/60">
        Type to search across all entities
      </p>
      <div className="flex gap-2 mt-3 text-xs text-muted-foreground/40">
        <span>servers</span>
        <span>•</span>
        <span>VMs</span>
        <span>•</span>
        <span>networks</span>
        <span>•</span>
        <span>settings</span>
      </div>
    </div>
  );
}
