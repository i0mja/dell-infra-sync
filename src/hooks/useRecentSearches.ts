import { useState, useEffect, useCallback } from 'react';
import { SearchResult } from '@/types/global-search';

const STORAGE_KEY = 'global-search-recent';
const MAX_RECENT = 8;

export function useRecentSearches() {
  const [recent, setRecent] = useState<SearchResult[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setRecent(parsed.slice(0, MAX_RECENT));
        }
      }
    } catch (e) {
      console.warn('Failed to load recent searches:', e);
    }
  }, []);

  // Save to localStorage whenever recent changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
    } catch (e) {
      console.warn('Failed to save recent searches:', e);
    }
  }, [recent]);

  const addRecent = useCallback((result: SearchResult) => {
    setRecent(prev => {
      // Remove duplicate if exists
      const filtered = prev.filter(r => r.id !== result.id);
      // Add to front and limit
      return [result, ...filtered].slice(0, MAX_RECENT);
    });
  }, []);

  const removeRecent = useCallback((id: string) => {
    setRecent(prev => prev.filter(r => r.id !== id));
  }, []);

  const clearRecent = useCallback(() => {
    setRecent([]);
  }, []);

  return {
    recent,
    addRecent,
    removeRecent,
    clearRecent,
  };
}
