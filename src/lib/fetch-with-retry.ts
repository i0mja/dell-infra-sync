/**
 * Utility for retrying async operations with exponential backoff
 * Designed to handle transient failures like 504 Gateway Timeout
 */

export interface RetryOptions {
  maxRetries?: number;       // Default: 3
  baseDelay?: number;        // Default: 1000ms
  maxDelay?: number;         // Default: 10000ms
  retryOn?: (error: any) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  retryOn: isRetryableError,
};

/**
 * Determines if an error is retryable (network issues, timeouts, 5xx errors)
 */
export function isRetryableError(error: any): boolean {
  if (!error) return false;
  
  // Network errors
  if (error.message?.includes('Failed to fetch') || 
      error.message?.includes('NetworkError') ||
      error.message?.includes('network') ||
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT') {
    return true;
  }
  
  // HTTP status codes that are retryable
  const status = error.status || error.statusCode || error.code;
  if (status === 504 || status === 503 || status === 502 || status === 429) {
    return true;
  }
  
  // Supabase specific errors
  if (error.message?.includes('504') || 
      error.message?.includes('Gateway Timeout') ||
      error.message?.includes('timeout')) {
    return true;
  }
  
  return false;
}

/**
 * Adds jitter to delay to prevent thundering herd
 */
function calculateDelay(attempt: number, baseDelay: number, maxDelay: number): number {
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
  return Math.min(exponentialDelay + jitter, maxDelay);
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute an async function with retry logic
 */
export async function fetchWithRetry<T>(
  fetchFn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: any;
  
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fetchFn();
    } catch (error: any) {
      lastError = error;
      
      // Check if we should retry
      const shouldRetry = attempt < opts.maxRetries && opts.retryOn(error);
      
      if (shouldRetry) {
        const delay = calculateDelay(attempt, opts.baseDelay, opts.maxDelay);
        console.log(
          `[fetchWithRetry] Attempt ${attempt + 1}/${opts.maxRetries + 1} failed, ` +
          `retrying in ${Math.round(delay)}ms...`,
          error.message || error
        );
        await sleep(delay);
      } else {
        // Not retrying - throw the error
        throw error;
      }
    }
  }
  
  // Should never reach here, but just in case
  throw lastError;
}

/**
 * Wrapper specifically for Supabase queries
 * Returns {data, error, retryCount} with retry logic applied
 */
export async function supabaseQueryWithRetry<T>(
  queryFn: () => Promise<{ data: T | null; error: any }>,
  options?: RetryOptions
): Promise<{ data: T | null; error: any; retryCount: number }> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: any = null;
  let retryCount = 0;
  
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const result = await queryFn();
      
      // Supabase returns errors in the result, not as exceptions
      if (result.error) {
        const shouldRetry = attempt < opts.maxRetries && opts.retryOn(result.error);
        
        if (shouldRetry) {
          lastError = result.error;
          retryCount = attempt + 1;
          const delay = calculateDelay(attempt, opts.baseDelay, opts.maxDelay);
          console.log(
            `[supabaseQueryWithRetry] Attempt ${attempt + 1}/${opts.maxRetries + 1} failed, ` +
            `retrying in ${Math.round(delay)}ms...`,
            result.error.message || result.error
          );
          await sleep(delay);
          continue;
        }
        
        // Not retrying - return the error
        return { data: null, error: result.error, retryCount };
      }
      
      // Success
      return { data: result.data, error: null, retryCount };
    } catch (error: any) {
      // Unexpected exception during query
      const shouldRetry = attempt < opts.maxRetries && opts.retryOn(error);
      
      if (shouldRetry) {
        lastError = error;
        retryCount = attempt + 1;
        const delay = calculateDelay(attempt, opts.baseDelay, opts.maxDelay);
        console.log(
          `[supabaseQueryWithRetry] Exception on attempt ${attempt + 1}/${opts.maxRetries + 1}, ` +
          `retrying in ${Math.round(delay)}ms...`,
          error.message || error
        );
        await sleep(delay);
        continue;
      }
      
      return { data: null, error, retryCount };
    }
  }
  
  // All retries exhausted
  return { data: null, error: lastError, retryCount };
}
