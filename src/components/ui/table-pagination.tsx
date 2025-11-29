import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

interface TablePaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  startIndex: number;
  endIndex: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onFirstPage: () => void;
  onLastPage: () => void;
  onNextPage: () => void;
  onPrevPage: () => void;
  canGoNext: boolean;
  canGoPrev: boolean;
}

export function TablePagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  startIndex,
  endIndex,
  onPageChange,
  onPageSizeChange,
  onFirstPage,
  onLastPage,
  onNextPage,
  onPrevPage,
  canGoNext,
  canGoPrev,
}: TablePaginationProps) {
  // Generate page numbers with ellipsis
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const showEllipsisThreshold = 7;

    if (totalPages <= showEllipsisThreshold) {
      // Show all pages if total is small
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Show first page
      pages.push(1);

      if (currentPage > 3) {
        pages.push("ellipsis-start");
      }

      // Show pages around current page
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (currentPage < totalPages - 2) {
        pages.push("ellipsis-end");
      }

      // Show last page
      pages.push(totalPages);
    }

    return pages;
  };

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/30">
      <div className="flex items-center gap-6">
        <div className="text-sm text-muted-foreground">
          Showing <span className="font-medium text-foreground">{startIndex + 1}</span> to{" "}
          <span className="font-medium text-foreground">{endIndex}</span> of{" "}
          <span className="font-medium text-foreground">{totalItems}</span> items
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Items per page:</span>
          <Select value={pageSize.toString()} onValueChange={(value) => onPageSizeChange(Number(value))}>
            <SelectTrigger className="h-8 w-[70px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
              <SelectItem value="250">250</SelectItem>
              <SelectItem value="500">500</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={onFirstPage}
            disabled={!canGoPrev}
            aria-label="Go to first page"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={onPrevPage}
            disabled={!canGoPrev}
            aria-label="Go to previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          {getPageNumbers().map((page, idx) => {
            if (typeof page === "string") {
              return (
                <span key={`${page}-${idx}`} className="px-2 text-muted-foreground">
                  …
                </span>
              );
            }

            return (
              <Button
                key={page}
                variant={currentPage === page ? "default" : "outline"}
                size="icon"
                className="h-8 w-8"
                onClick={() => onPageChange(page)}
                aria-label={`Go to page ${page}`}
                aria-current={currentPage === page ? "page" : undefined}
              >
                {page}
              </Button>
            );
          })}
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={onNextPage}
            disabled={!canGoNext}
            aria-label="Go to next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={onLastPage}
            disabled={!canGoNext}
            aria-label="Go to last page"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
