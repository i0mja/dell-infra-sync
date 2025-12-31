/**
 * HMAC signature verification for secure Job Executor → Edge Function communication
 * 
 * This module verifies HMAC-SHA256 signatures on requests from the Job Executor.
 * The signature ensures:
 * - Only authorized callers with the shared secret can make requests
 * - Requests cannot be replayed (timestamp freshness check)
 * - Payloads cannot be tampered with (signature covers entire payload)
 * 
 * The shared secret is configured via environment variable EXECUTOR_SHARED_SECRET.
 * Generate and copy this secret from Settings > System > Executor Authentication.
 */

import { logger } from './logger.ts';

const MAX_AGE_SECONDS = 300; // 5 minutes - requests older than this are rejected

/**
 * Verify HMAC signature on incoming request from Job Executor
 * 
 * @param req The incoming request (to extract signature headers)
 * @param payload The parsed JSON body to verify
 * @returns true if signature is valid and timestamp is fresh
 */
export async function verifyExecutorRequest(req: Request, payload: unknown): Promise<boolean> {
  const sharedSecret = Deno.env.get('EXECUTOR_SHARED_SECRET');
  
  // If no secret configured, allow requests (backward compatibility)
  // This enables gradual rollout - configure secret when ready
  if (!sharedSecret) {
    logger.debug('HMAC verification skipped - EXECUTOR_SHARED_SECRET not configured');
    return true;
  }
  
  const signature = req.headers.get('x-executor-signature');
  const timestamp = req.headers.get('x-executor-timestamp');
  
  // If headers missing but secret is configured, reject
  if (!signature || !timestamp) {
    logger.security('HMAC verification failed - missing headers', false);
    return false;
  }
  
  // Check timestamp freshness (prevent replay attacks)
  const requestAge = Date.now() / 1000 - parseInt(timestamp, 10);
  if (isNaN(requestAge) || requestAge > MAX_AGE_SECONDS || requestAge < -30) {
    // Allow 30 seconds clock skew for future timestamps
    logger.security('HMAC verification failed - stale timestamp', false);
    return false;
  }
  
  // Reconstruct the signed message
  // IMPORTANT: Must match exactly how Job Executor signs it
  const message = sortedJsonStringify(payload) + timestamp;
  
  // Compute expected signature
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(sharedSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(message)
  );
  
  const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  // Timing-safe comparison
  if (!timingSafeEqual(signature, expectedSignature)) {
    logger.security('HMAC verification failed - invalid signature', false);
    return false;
  }
  
  logger.security('HMAC verification', true);
  return true;
}

/**
 * JSON stringify with sorted keys to ensure consistent signature
 */
function sortedJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  
  if (Array.isArray(obj)) {
    return '[' + obj.map(sortedJsonStringify).join(',') + ']';
  }
  
  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
  const parts = sortedKeys.map(key => {
    const value = (obj as Record<string, unknown>)[key];
    return JSON.stringify(key) + ':' + sortedJsonStringify(value);
  });
  
  return '{' + parts.join(',') + '}';
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  
  return result === 0;
}

export default verifyExecutorRequest;
