import { SearchResult, CATEGORY_LABELS } from "@/types/global-search";
import { getCategoryIcon } from "@/lib/search-category-icons";
import { CommandItem } from "@/components/ui/command";
import { cn } from "@/lib/utils";

interface SearchResultItemProps {
  result: SearchResult;
  onSelect: (result: SearchResult) => void;
}

export function SearchResultItem({ result, onSelect }: SearchResultItemProps) {
  const Icon = getCategoryIcon(result.category);
  
  return (
    <CommandItem
      value={`${result.title} ${result.subtitle || ''} ${result.id}`}
      onSelect={() => onSelect(result)}
      className="flex items-center gap-3 px-3 py-2.5 cursor-pointer"
    >
      <div className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md",
        result.category === 'quick_action' 
          ? "bg-primary/10 text-primary" 
          : "bg-muted text-muted-foreground"
      )}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex flex-col flex-1 min-w-0">
        <span className="font-medium truncate">{result.title}</span>
        {result.subtitle && (
          <span className="text-xs text-muted-foreground truncate">
            {result.subtitle}
          </span>
        )}
      </div>
      <span className="text-xs text-muted-foreground/60 hidden sm:block">
        {CATEGORY_LABELS[result.category]}
      </span>
    </CommandItem>
  );
}
