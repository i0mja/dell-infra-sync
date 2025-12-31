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
 * Result of dual authentication check
 */
export interface AuthResult {
  authenticated: boolean;
  method: 'hmac' | 'jwt' | 'none';
  userId?: string;
}

/**
 * Verify request using dual authentication: HMAC (for Job Executor) or JWT (for frontend)
 * 
 * Priority:
 * 1. If HMAC headers present → verify HMAC signature
 * 2. If JWT token present → verify user authentication
 * 3. If no secret configured → allow (backward compatibility)
 * 4. Otherwise → reject
 * 
 * @param req The incoming request
 * @param payload The parsed JSON body
 * @param supabaseClient Client with auth header for JWT verification
 */
export async function verifyRequestDualAuth(
  req: Request, 
  payload: unknown,
  supabaseClient: any
): Promise<AuthResult> {
  const sharedSecret = Deno.env.get('EXECUTOR_SHARED_SECRET');
  
  // Debug: Log what auth headers we received
  const signature = req.headers.get('x-executor-signature');
  const timestamp = req.headers.get('x-executor-timestamp');
  const authHeader = req.headers.get('authorization');
  
  // Use console.log for auth debugging so logs are visible in production
  console.log(`[HMAC-DEBUG] Auth check: HMAC headers=${!!signature && !!timestamp}, JWT=${!!authHeader?.startsWith('Bearer ')}, secret=${sharedSecret ? `configured (${sharedSecret.substring(0, 4)}...)` : 'NOT SET'}`);
  
  // Check for HMAC headers first (Job Executor path)
  if (signature && timestamp) {
    console.log(`[HMAC-DEBUG] HMAC attempt: sig prefix=${signature.substring(0, 8)}..., ts=${timestamp}`);
    // HMAC auth attempt - verify the signature
    const valid = await verifyHmacSignature(payload, signature, timestamp, sharedSecret);
    if (valid) {
      logger.security('Dual auth: HMAC verification', true);
      return { authenticated: true, method: 'hmac' };
    } else {
      logger.security('Dual auth: HMAC verification failed', false);
      return { authenticated: false, method: 'hmac' };
    }
  }
  
  // No HMAC headers - try JWT auth (frontend path)
  if (authHeader?.startsWith('Bearer ')) {
    logger.debug('Auth debug: Attempting JWT verification');
    try {
      // Extract the JWT token and pass it directly to getUser()
      // In edge functions, getUser() without a token doesn't work - there's no session context
      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error } = await supabaseClient.auth.getUser(token);
      if (user && !error) {
        logger.security('Dual auth: JWT verification', true);
        logger.debug(`Auth debug: JWT verified for user ${user.id}`);
        return { authenticated: true, method: 'jwt', userId: user.id };
      } else {
        logger.debug(`Auth debug: JWT returned no user - ${error?.message || 'no error message'}`);
      }
    } catch (e) {
      logger.debug(`Auth debug: JWT exception - ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  
  // Neither auth method succeeded
  // If no secret is configured, allow for backward compatibility
  if (!sharedSecret) {
    logger.debug('Dual auth: No secret configured, allowing request (backward compat)');
    return { authenticated: true, method: 'none' };
  }
  
  // Secret is configured but no valid auth provided
  logger.security('Dual auth: No valid authentication provided', false);
  logger.debug(`Auth debug: Rejecting - has HMAC=${!!signature}, has JWT=${!!authHeader?.startsWith('Bearer ')}`);
  return { authenticated: false, method: 'none' };
}

/**
 * Verify HMAC signature (internal helper)
 */
async function verifyHmacSignature(
  payload: unknown, 
  signature: string, 
  timestamp: string,
  sharedSecret: string | undefined
): Promise<boolean> {
  if (!sharedSecret) {
    console.log('[HMAC-DEBUG] FAIL: No shared secret configured in edge function');
    return false;
  }
  
  // Check timestamp freshness (prevent replay attacks)
  const now = Date.now() / 1000;
  const ts = parseInt(timestamp, 10);
  const requestAge = now - ts;
  
  console.log(`[HMAC-DEBUG] Timestamp check: received=${ts}, now=${Math.floor(now)}, age=${Math.floor(requestAge)}s (max ${MAX_AGE_SECONDS}s)`);
  
  if (isNaN(requestAge) || requestAge > MAX_AGE_SECONDS || requestAge < -30) {
    console.log(`[HMAC-DEBUG] FAIL: Stale timestamp - age ${Math.floor(requestAge)}s exceeds limit`);
    return false;
  }
  
  // Reconstruct the signed message
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
  
  const match = timingSafeEqual(signature, expectedSignature);
  
  if (!match) {
    console.log(`[HMAC-DEBUG] FAIL: Signature mismatch!`);
    console.log(`[HMAC-DEBUG]   Received sig: ${signature.substring(0, 16)}...`);
    console.log(`[HMAC-DEBUG]   Expected sig: ${expectedSignature.substring(0, 16)}...`);
    console.log(`[HMAC-DEBUG]   Secret prefix: ${sharedSecret.substring(0, 4)}...`);
    console.log(`[HMAC-DEBUG]   Payload keys: ${Object.keys(payload as object).join(', ')}`);
  } else {
    console.log(`[HMAC-DEBUG] SUCCESS: Signature verified`);
  }
  
  return match;
}

/**
 * Verify HMAC signature on incoming request from Job Executor (legacy function)
 * 
 * @deprecated Use verifyRequestDualAuth instead for dual auth support
 * @param req The incoming request (to extract signature headers)
 * @param payload The parsed JSON body to verify
 * @returns true if signature is valid and timestamp is fresh
 */
export async function verifyExecutorRequest(req: Request, payload: unknown): Promise<boolean> {
  const sharedSecret = Deno.env.get('EXECUTOR_SHARED_SECRET');
  
  // If no secret configured, allow requests (backward compatibility)
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
  
  const valid = await verifyHmacSignature(payload, signature, timestamp, sharedSecret);
  if (valid) {
    logger.security('HMAC verification', true);
  } else {
    logger.security('HMAC verification failed - invalid signature', false);
  }
  return valid;
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
