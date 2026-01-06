import { useState, useEffect, useCallback, useRef } from 'react';
import { supabaseQueryWithRetry, RetryOptions } from '@/lib/fetch-with-retry';

export interface UseRetryableQueryOptions<T> extends RetryOptions {
  enabled?: boolean;
  refetchInterval?: number;
  onError?: (error: any) => void;
  onSuccess?: (data: T) => void;
  staleTime?: number; // Keep showing old data while refetching
}

export interface UseRetryableQueryResult<T> {
  data: T | null;
  error: any;
  isLoading: boolean;
  isError: boolean;
  isRetrying: boolean;
  retryCount: number;
  refetch: () => Promise<void>;
}

/**
 * Custom hook for Supabase queries with automatic retry logic
 * Implements stale-while-revalidate pattern to show old data during retries
 */
export function useRetryableQuery<T>(
  queryKey: string,
  queryFn: () => Promise<{ data: T | null; error: any }>,
  options: UseRetryableQueryOptions<T> = {}
): UseRetryableQueryResult<T> {
  const {
    enabled = true,
    refetchInterval,
    onError,
    onSuccess,
    staleTime = 30000, // 30 seconds default
    ...retryOptions
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  
  const lastFetchTime = useRef<number>(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchData = useCallback(async (isBackground = false) => {
    if (!enabled) return;

    // Only show loading state on initial fetch, not background refetches
    if (!isBackground) {
      setIsLoading(true);
    }
    setIsRetrying(false);

    const result = await supabaseQueryWithRetry(queryFn, retryOptions);
    
    if (result.retryCount > 0) {
      setIsRetrying(true);
    }
    setRetryCount(result.retryCount);

    if (result.error) {
      setError(result.error);
      onError?.(result.error);
      // Keep old data on error (stale-while-revalidate)
    } else {
      setData(result.data);
      setError(null);
      lastFetchTime.current = Date.now();
      onSuccess?.(result.data as T);
    }

    setIsLoading(false);
    setIsRetrying(false);
  }, [enabled, queryFn, onError, onSuccess, retryOptions]);

  // Initial fetch
  useEffect(() => {
    if (enabled) {
      fetchData(false);
    }
  }, [enabled, queryKey]);

  // Set up refetch interval
  useEffect(() => {
    if (refetchInterval && enabled) {
      intervalRef.current = setInterval(() => {
        // Only refetch if data is stale
        if (Date.now() - lastFetchTime.current > staleTime) {
          fetchData(true);
        }
      }, refetchInterval);

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    }
  }, [refetchInterval, enabled, staleTime, fetchData]);

  const refetch = useCallback(async () => {
    await fetchData(false);
  }, [fetchData]);

  return {
    data,
    error,
    isLoading,
    isError: !!error,
    isRetrying,
    retryCount,
    refetch,
  };
}
