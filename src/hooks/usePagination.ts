import { useState, useEffect } from "react";

interface UsePaginationReturn<T> {
  currentPage: number;
  pageSize: number;
  totalPages: number;
  paginatedItems: T[];
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  goToFirstPage: () => void;
  goToLastPage: () => void;
  goToNextPage: () => void;
  goToPrevPage: () => void;
  canGoNext: boolean;
  canGoPrev: boolean;
  startIndex: number;
  endIndex: number;
}

export function usePagination<T>(
  items: T[],
  storageKey: string,
  defaultPageSize: number = 50
): UsePaginationReturn<T> {
  // Get initial page size from localStorage
  const getInitialPageSize = () => {
    try {
      const stored = localStorage.getItem(`${storageKey}-pageSize`);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if ([25, 50, 100, 250, 500].includes(parsed)) {
          return parsed;
        }
      }
    } catch (error) {
      console.error("Error reading page size from localStorage:", error);
    }
    return defaultPageSize;
  };

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(getInitialPageSize);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  // Reset to page 1 if current page exceeds total pages
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [totalPages, currentPage]);

  // Reset to page 1 when items length changes (filters applied)
  const itemsLengthRef = useState(items.length)[0];
  useEffect(() => {
    if (items.length !== itemsLengthRef) {
      setCurrentPage(1);
    }
  }, [items.length]);

  const setPageSize = (size: number) => {
    setPageSizeState(size);
    setCurrentPage(1); // Reset to first page when changing page size
    try {
      localStorage.setItem(`${storageKey}-pageSize`, size.toString());
    } catch (error) {
      console.error("Error saving page size to localStorage:", error);
    }
  };

  const setPage = (page: number) => {
    const validPage = Math.max(1, Math.min(page, totalPages));
    setCurrentPage(validPage);
  };

  const goToFirstPage = () => setPage(1);
  const goToLastPage = () => setPage(totalPages);
  const goToNextPage = () => setPage(currentPage + 1);
  const goToPrevPage = () => setPage(currentPage - 1);

  const canGoNext = currentPage < totalPages;
  const canGoPrev = currentPage > 1;

  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, items.length);
  const paginatedItems = items.slice(startIndex, endIndex);

  return {
    currentPage,
    pageSize,
    totalPages,
    paginatedItems,
    setPage,
    setPageSize,
    goToFirstPage,
    goToLastPage,
    goToNextPage,
    goToPrevPage,
    canGoNext,
    canGoPrev,
    startIndex,
    endIndex,
  };
}
