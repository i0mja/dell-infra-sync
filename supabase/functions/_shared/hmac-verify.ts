/**
 * HMAC signature verification for secure Job Executor → Edge Function communication
 * 
 * This module verifies HMAC-SHA256 signatures on requests from the Job Executor.
 * The signature ensures:
 * - Only authorized callers with the shared secret can make requests
 * - Requests cannot be replayed (timestamp freshness check)
 * - Payloads cannot be tampered with (signature covers entire payload)
 * 
 * The shared secret is read from the database (activity_settings.executor_shared_secret_encrypted)
 * and decrypted at runtime, ensuring a single source of truth.
 */

import { logger } from './logger.ts';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const MAX_AGE_SECONDS = 300; // 5 minutes - requests older than this are rejected

// Cache the secret for 60 seconds to avoid repeated database lookups
let cachedSecret: string | null = null;
let cacheExpiry: number = 0;
const CACHE_TTL_MS = 60000; // 60 seconds

/**
 * Create a service role client that bypasses RLS
 * This is needed because HMAC requests have no user context
 */
function createServiceRoleClient() {
  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, serviceKey);
}

/**
 * Result of dual authentication check
 */
export interface AuthResult {
  authenticated: boolean;
  method: 'hmac' | 'jwt' | 'none';
  userId?: string;
}

/**
 * Fetch the executor shared secret from the database
 * Uses a SERVICE ROLE client to bypass RLS (HMAC requests have no user context)
 */
async function getSharedSecretFromDatabase(_supabaseClient: any): Promise<string | null> {
  const now = Date.now();
  
  // Return cached value if still valid
  if (cachedSecret && now < cacheExpiry) {
    console.log(`[HMAC-DEBUG] Using cached secret (prefix: ${cachedSecret.substring(0, 4)}...)`);
    return cachedSecret;
  }
  
  try {
    // Use service role client to bypass RLS
    const serviceClient = createServiceRoleClient();
    
    // PRIORITY 1: Try database FIRST (GUI-managed source of truth)
    console.log('[HMAC-DEBUG] Fetching secret from database using SERVICE ROLE client...');
    
    // Get the encrypted secret from activity_settings
    const { data: settings, error: settingsError } = await serviceClient
      .from('activity_settings')
      .select('executor_shared_secret_encrypted')
      .maybeSingle();
    
    if (!settingsError && settings?.executor_shared_secret_encrypted) {
      // Get the encryption key
      const { data: encryptionKey, error: keyError } = await serviceClient.rpc('get_encryption_key');
      
      if (!keyError && encryptionKey) {
        // Decrypt the secret
        const { data: decryptedSecret, error: decryptError } = await serviceClient.rpc('decrypt_password', {
          encrypted: settings.executor_shared_secret_encrypted,
          key: encryptionKey
        });
        
        if (!decryptError && decryptedSecret) {
          console.log(`[HMAC-DEBUG] SUCCESS: Using secret from DATABASE (prefix: ${decryptedSecret.substring(0, 4)}...)`);
          cachedSecret = decryptedSecret;
          cacheExpiry = now + CACHE_TTL_MS;
          return decryptedSecret;
        } else {
          console.log(`[HMAC-DEBUG] Failed to decrypt secret: ${decryptError?.message || 'no result'}`);
        }
      } else {
        console.log(`[HMAC-DEBUG] Failed to get encryption key: ${keyError?.message || 'no key'}`);
      }
    } else if (settingsError) {
      console.log(`[HMAC-DEBUG] Error fetching settings: ${settingsError.message}`);
    } else {
      console.log('[HMAC-DEBUG] No encrypted secret found in database');
    }
    
    // PRIORITY 2: Fallback to environment variable (only if database lookup failed)
    const envSecret = Deno.env.get('EXECUTOR_SHARED_SECRET');
    if (envSecret) {
      console.log(`[HMAC-DEBUG] FALLBACK: Using secret from environment variable (prefix: ${envSecret.substring(0, 4)}...)`);
      cachedSecret = envSecret;
      cacheExpiry = now + CACHE_TTL_MS;
      return envSecret;
    }
    
    console.log('[HMAC-DEBUG] No secret found in database or environment');
    return null;
  } catch (err) {
    console.log(`[HMAC-DEBUG] Exception fetching secret: ${err instanceof Error ? err.message : String(err)}`);
    
    // Last resort fallback on exception
    const envSecret = Deno.env.get('EXECUTOR_SHARED_SECRET');
    if (envSecret) {
      console.log(`[HMAC-DEBUG] EXCEPTION FALLBACK: Using env secret (prefix: ${envSecret.substring(0, 4)}...)`);
      return envSecret;
    }
    return null;
  }
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
  // Debug: Log what auth headers we received
  const signature = req.headers.get('x-executor-signature');
  const timestamp = req.headers.get('x-executor-timestamp');
  const authHeader = req.headers.get('authorization');
  
  // Check for HMAC headers first (Job Executor path)
  if (signature && timestamp) {
    console.log(`[HMAC-DEBUG] HMAC attempt: sig prefix=${signature.substring(0, 8)}..., ts=${timestamp}`);
    
    // Get the shared secret from database (or env as fallback)
    const sharedSecret = await getSharedSecretFromDatabase(supabaseClient);
    
    console.log(`[HMAC-DEBUG] Auth check: HMAC headers=true, secret=${sharedSecret ? `configured (${sharedSecret.substring(0, 4)}...)` : 'NOT SET'}`);
    
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
  // Check if secret is configured
  const sharedSecret = await getSharedSecretFromDatabase(supabaseClient);
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
  sharedSecret: string | null
): Promise<boolean> {
  if (!sharedSecret) {
    console.log('[HMAC-DEBUG] FAIL: No shared secret available');
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
 * @param supabaseClient Optional client for database secret lookup
 * @returns true if signature is valid and timestamp is fresh
 */
export async function verifyExecutorRequest(
  req: Request, 
  payload: unknown,
  supabaseClient?: any
): Promise<boolean> {
  // Get shared secret - prefer database, fall back to env
  let sharedSecret: string | null = null;
  
  if (supabaseClient) {
    sharedSecret = await getSharedSecretFromDatabase(supabaseClient);
  } else {
    sharedSecret = Deno.env.get('EXECUTOR_SHARED_SECRET') || null;
  }
  
  // If no secret configured, allow requests (backward compatibility)
  if (!sharedSecret) {
    logger.debug('HMAC verification skipped - no secret configured');
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
 * Clear the cached secret (call when secret is regenerated)
 */
export function clearSecretCache(): void {
  cachedSecret = null;
  cacheExpiry = 0;
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
