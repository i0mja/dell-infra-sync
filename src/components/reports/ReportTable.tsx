import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import { usePagination } from "@/hooks/usePagination";
import { ArrowUp, ArrowDown, ArrowUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ReportColumn {
  key: string;
  label: string;
  format?: (value: any, row: any) => React.ReactNode;
  sortable?: boolean;
}

interface ReportTableProps {
  data: any[];
  columns: ReportColumn[];
  visibleColumns?: string[];
  isLoading?: boolean;
  searchTerm?: string;
}

export function ReportTable({ 
  data, 
  columns, 
  visibleColumns, 
  isLoading = false,
  searchTerm = "" 
}: ReportTableProps) {
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  // Filter columns based on visibility
  const displayColumns = useMemo(() => {
    if (!visibleColumns || visibleColumns.length === 0) {
      return columns;
    }
    return columns.filter((col) => visibleColumns.includes(col.key));
  }, [columns, visibleColumns]);

  // Filter data by search term
  const filteredData = useMemo(() => {
    if (!searchTerm.trim()) return data;
    const term = searchTerm.toLowerCase();
    return data.filter((row) =>
      Object.values(row).some((value) =>
        String(value ?? "").toLowerCase().includes(term)
      )
    );
  }, [data, searchTerm]);

  // Sort data
  const sortedData = useMemo(() => {
    if (!sortColumn) return filteredData;
    
    return [...filteredData].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];
      
      // Handle null/undefined
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return sortDirection === "asc" ? 1 : -1;
      if (bVal == null) return sortDirection === "asc" ? -1 : 1;
      
      // Handle dates
      if (typeof aVal === "string" && aVal.match(/^\d{4}-\d{2}-\d{2}/)) {
        const dateA = new Date(aVal).getTime();
        const dateB = new Date(bVal).getTime();
        return sortDirection === "asc" ? dateA - dateB : dateB - dateA;
      }
      
      // Handle numbers
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
      }
      
      // Handle strings
      const strA = String(aVal).toLowerCase();
      const strB = String(bVal).toLowerCase();
      const comparison = strA.localeCompare(strB);
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [filteredData, sortColumn, sortDirection]);

  // Pagination
  const pagination = usePagination(sortedData, "report-table", 25);

  const handleSort = (columnKey: string) => {
    if (sortColumn === columnKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(columnKey);
      setSortDirection("asc");
    }
  };

  const getSortIcon = (columnKey: string) => {
    if (sortColumn !== columnKey) {
      return <ArrowUpDown className="h-3 w-3 ml-1 opacity-50" />;
    }
    return sortDirection === "asc" 
      ? <ArrowUp className="h-3 w-3 ml-1" />
      : <ArrowDown className="h-3 w-3 ml-1" />;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (sortedData.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        No data available for the selected filters
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
            <TableRow>
              {displayColumns.map((col) => (
                <TableHead 
                  key={col.key}
                  className={cn(
                    "whitespace-nowrap",
                    col.sortable !== false && "cursor-pointer select-none hover:bg-muted"
                  )}
                  onClick={() => col.sortable !== false && handleSort(col.key)}
                >
                  <div className="flex items-center">
                    {col.label}
                    {col.sortable !== false && getSortIcon(col.key)}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagination.paginatedItems.map((row, idx) => (
              <TableRow key={idx} className="hover:bg-muted/50">
                {displayColumns.map((col) => (
                  <TableCell key={col.key}>
                    {col.format ? col.format(row[col.key], row) : row[col.key] ?? "-"}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      
      <TablePagination
        currentPage={pagination.currentPage}
        totalPages={pagination.totalPages}
        startIndex={pagination.startIndex}
        endIndex={pagination.endIndex}
        totalItems={sortedData.length}
        pageSize={pagination.pageSize}
        onPageChange={pagination.setPage}
        onPageSizeChange={pagination.setPageSize}
        onFirstPage={pagination.goToFirstPage}
        onLastPage={pagination.goToLastPage}
        onNextPage={pagination.goToNextPage}
        onPrevPage={pagination.goToPrevPage}
        canGoPrev={pagination.canGoPrev}
        canGoNext={pagination.canGoNext}
      />
    </div>
  );
}
