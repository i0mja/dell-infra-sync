import { useState, useCallback, useEffect } from 'react';

interface AcknowledgmentRecord {
  dismissedAt: number;
  itemCount: number;
}

interface AcknowledgmentState {
  [categoryId: string]: AcknowledgmentRecord;
}

const STORAGE_KEY = 'alert-acknowledgments';
const EXPIRY_HOURS = 24;

function loadFromStorage(): AcknowledgmentState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load alert acknowledgments:', e);
  }
  return {};
}

function saveToStorage(state: AcknowledgmentState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save alert acknowledgments:', e);
  }
}

export function useAlertAcknowledgment() {
  const [acknowledgments, setAcknowledgments] = useState<AcknowledgmentState>(loadFromStorage);

  // Sync to localStorage whenever state changes
  useEffect(() => {
    saveToStorage(acknowledgments);
  }, [acknowledgments]);

  const acknowledge = useCallback((categoryId: string, itemCount: number) => {
    setAcknowledgments(prev => ({
      ...prev,
      [categoryId]: {
        dismissedAt: Date.now(),
        itemCount,
      },
    }));
  }, []);

  const isAcknowledged = useCallback((categoryId: string, currentCount: number): boolean => {
    const record = acknowledgments[categoryId];
    if (!record) return false;

    // Reset if count changed (new issues appeared or some resolved)
    if (record.itemCount !== currentCount) return false;

    // Reset if expired (older than 24 hours)
    const expiryMs = EXPIRY_HOURS * 60 * 60 * 1000;
    if (Date.now() - record.dismissedAt > expiryMs) return false;

    return true;
  }, [acknowledgments]);

  const unacknowledge = useCallback((categoryId: string) => {
    setAcknowledgments(prev => {
      const next = { ...prev };
      delete next[categoryId];
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setAcknowledgments({});
  }, []);

  const acknowledgeAll = useCallback((categories: { id: string; count: number }[]) => {
    setAcknowledgments(prev => {
      const next = { ...prev };
      categories.forEach(({ id, count }) => {
        next[id] = {
          dismissedAt: Date.now(),
          itemCount: count,
        };
      });
      return next;
    });
  }, []);

  return {
    acknowledge,
    isAcknowledged,
    unacknowledge,
    clearAll,
    acknowledgeAll,
  };
}
