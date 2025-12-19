import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useGlobalSearchContext } from "@/contexts/GlobalSearchContext";
import { useGlobalSearch } from "@/hooks/useGlobalSearch";
import { useRecentSearches } from "@/hooks/useRecentSearches";
import { SearchResult, CATEGORY_LABELS, SearchCategory } from "@/types/global-search";
import { navigateToResult } from "@/lib/search-navigation";
import { SearchResultItem } from "./SearchResultItem";
import { SearchEmpty, SearchLoading, SearchHint } from "./SearchStates";
import { Clock, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// Priority order for categories
const CATEGORY_ORDER: SearchCategory[] = [
  'quick_action',
  'servers',
  'vms',
  'hosts',
  'clusters',
  'networks',
  'datastores',
  'protection_groups',
  'replication_targets',
  'maintenance',
  'jobs',
  'server_groups',
  'settings',
  'credentials',
  'firmware',
  'iso_images',
];

export function GlobalSearchDialog() {
  const navigate = useNavigate();
  const { isOpen, closeSearch } = useGlobalSearchContext();
  const { query, setQuery, groupedResults, isLoading, error, clearSearch } = useGlobalSearch();
  const { recent, addRecent, clearRecent } = useRecentSearches();

  // Reset query when dialog closes
  useEffect(() => {
    if (!isOpen) {
      clearSearch();
    }
  }, [isOpen, clearSearch]);

  const handleSelect = useCallback((result: SearchResult) => {
    addRecent(result);
    closeSearch();
    navigateToResult(result, navigate);
  }, [addRecent, closeSearch, navigate]);

  const handleRecentSelect = useCallback((result: SearchResult) => {
    closeSearch();
    navigateToResult(result, navigate);
  }, [closeSearch, navigate]);

  // Get sorted categories that have results
  const sortedCategories = CATEGORY_ORDER.filter(
    cat => groupedResults[cat]?.length > 0
  );

  const hasResults = sortedCategories.length > 0;
  const showRecent = !query && recent.length > 0;
  const showHint = !query && recent.length === 0;

  return (
    <CommandDialog open={isOpen} onOpenChange={(open) => !open && closeSearch()}>
      <CommandInput
        placeholder="Search servers, VMs, networks, settings..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="max-h-[400px]">
        {/* Loading state */}
        {isLoading && query.length >= 2 && <SearchLoading />}

        {/* Error state */}
        {error && (
          <CommandEmpty>
            <SearchEmpty query={query} />
          </CommandEmpty>
        )}

        {/* Empty state when searching */}
        {!isLoading && query.length >= 2 && !hasResults && !error && (
          <CommandEmpty>
            <SearchEmpty query={query} />
          </CommandEmpty>
        )}

        {/* Hint when no query and no recent */}
        {showHint && <SearchHint />}

        {/* Recent searches */}
        {showRecent && (
          <CommandGroup 
            heading={
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="h-3 w-3" />
                  <span>Recent</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearRecent();
                  }}
                >
                  Clear
                </Button>
              </div>
            }
          >
            {recent.map((result) => (
              <SearchResultItem
                key={`recent-${result.id}`}
                result={result}
                onSelect={handleRecentSelect}
              />
            ))}
          </CommandGroup>
        )}

        {/* Search results grouped by category */}
        {!isLoading && hasResults && (
          <>
            {sortedCategories.map((category, index) => (
              <div key={category}>
                {index > 0 && <CommandSeparator />}
                <CommandGroup heading={CATEGORY_LABELS[category]}>
                  {groupedResults[category].map((result) => (
                    <SearchResultItem
                      key={result.id}
                      result={result}
                      onSelect={handleSelect}
                    />
                  ))}
                </CommandGroup>
              </div>
            ))}
          </>
        )}
      </CommandList>
      
      {/* Footer with keyboard hints */}
      <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <kbd className="rounded border bg-muted px-1">↑↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border bg-muted px-1">↵</kbd>
            select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border bg-muted px-1">esc</kbd>
            close
          </span>
        </div>
        <span className="hidden sm:block">
          Press <kbd className="rounded border bg-muted px-1">⌘K</kbd> anywhere to search
        </span>
      </div>
    </CommandDialog>
  );
}
