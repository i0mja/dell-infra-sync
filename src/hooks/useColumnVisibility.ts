import { useState, useEffect } from "react";

export function useColumnVisibility(storageKey: string, defaultColumns: string[]) {
  const [visibleColumns, setVisibleColumns] = useState<string[]>(defaultColumns);

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        setVisibleColumns(JSON.parse(stored));
      } catch (error) {
        console.error("Failed to parse column visibility:", error);
      }
    }
  }, [storageKey]);

  const toggleColumn = (columnKey: string) => {
    const updated = visibleColumns.includes(columnKey)
      ? visibleColumns.filter((c) => c !== columnKey)
      : [...visibleColumns, columnKey];
    
    setVisibleColumns(updated);
    localStorage.setItem(storageKey, JSON.stringify(updated));
  };

  const isColumnVisible = (columnKey: string) => visibleColumns.includes(columnKey);

  const setColumns = (columns: string[]) => {
    setVisibleColumns(columns);
    localStorage.setItem(storageKey, JSON.stringify(columns));
  };

  return {
    visibleColumns,
    isColumnVisible,
    toggleColumn,
    setColumns,
  };
}
