import { useState, useEffect } from "react";

export interface SavedView {
  id: string;
  name: string;
  filters: Record<string, any>;
  sortField?: string;
  sortDirection?: "asc" | "desc";
  visibleColumns?: string[];
}

export function useSavedViews(storageKey: string) {
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [currentView, setCurrentView] = useState<SavedView | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        setSavedViews(JSON.parse(stored));
      } catch (error) {
        console.error("Failed to parse saved views:", error);
      }
    }
  }, [storageKey]);

  const saveView = (name: string, filters: Record<string, any>, sortField?: string, sortDirection?: "asc" | "desc", visibleColumns?: string[]) => {
    const newView: SavedView = {
      id: Date.now().toString(),
      name,
      filters,
      sortField,
      sortDirection,
      visibleColumns,
    };

    const updated = [...savedViews, newView];
    setSavedViews(updated);
    localStorage.setItem(storageKey, JSON.stringify(updated));
    setCurrentView(newView);
  };

  const loadView = (viewId: string) => {
    const view = savedViews.find((v) => v.id === viewId);
    if (view) {
      setCurrentView(view);
    }
  };

  const deleteView = (viewId: string) => {
    const updated = savedViews.filter((v) => v.id !== viewId);
    setSavedViews(updated);
    localStorage.setItem(storageKey, JSON.stringify(updated));
    if (currentView?.id === viewId) {
      setCurrentView(null);
    }
  };

  const clearView = () => {
    setCurrentView(null);
  };

  return {
    savedViews,
    currentView,
    saveView,
    loadView,
    deleteView,
    clearView,
  };
}
