/**
 * HMAC request verification for Job Executor authentication.
 * 
 * This provides defense-in-depth for edge functions called by the Job Executor.
 * Requests must include:
 * - X-Executor-Signature: HMAC-SHA256 signature of payload + timestamp
 * - X-Executor-Timestamp: Unix timestamp when request was signed
 * 
 * The signature prevents:
 * - Unauthorized callers (they don't have the shared secret)
 * - Replay attacks (timestamp must be within MAX_AGE_SECONDS)
 * - Tampering (any payload modification invalidates signature)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logger } from './logger.ts';

const MAX_AGE_SECONDS = 300; // 5 minutes - requests older than this are rejected

// Cache the shared secret to avoid repeated database queries
let _cachedSecret: string | null = null;
let _secretFetched = false;

/**
 * Get the shared secret from environment variable or database.
 * Caches the result to avoid repeated database queries.
 */
async function getSharedSecret(): Promise<string | null> {
  // First check environment variable (takes precedence)
  const envSecret = Deno.env.get('EXECUTOR_SHARED_SECRET');
  if (envSecret) {
    return envSecret;
  }
  
  // Return cached database secret if already fetched
  if (_secretFetched) {
    return _cachedSecret;
  }
  
  // Mark as fetched to avoid repeated DB calls
  _secretFetched = true;
  
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !serviceRoleKey) {
      logger.warn('Cannot fetch secret from database - missing SUPABASE_URL or SERVICE_ROLE_KEY');
      return null;
    }
    
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    
    // Get encrypted secret from activity_settings
    const { data: settings, error: settingsError } = await supabase
      .from("activity_settings")
      .select("executor_shared_secret_encrypted")
      .maybeSingle();
    
    if (settingsError) {
      logger.warn('Failed to fetch activity_settings: ' + settingsError.message);
      return null;
    }
    
    if (!settings?.executor_shared_secret_encrypted) {
      logger.debug('HMAC secret not configured in database');
      return null;
    }
    
    // Get encryption key
    const { data: encryptionKey, error: keyError } = await supabase.rpc("get_encryption_key");
    if (keyError || !encryptionKey) {
      logger.warn('Failed to get encryption key: ' + (keyError?.message || 'not configured'));
      return null;
    }
    
    // Decrypt the secret
    const { data: decryptedSecret, error: decryptError } = await supabase.rpc("decrypt_password", {
      encrypted: settings.executor_shared_secret_encrypted,
      key: encryptionKey
    });
    
    if (decryptError || !decryptedSecret) {
      logger.warn('Failed to decrypt secret: ' + (decryptError?.message || 'decryption returned null'));
      return null;
    }
    
    _cachedSecret = decryptedSecret;
    logger.debug('HMAC secret loaded from database');
    
    return _cachedSecret;
  } catch (error) {
    logger.warn('Exception fetching secret from database: ' + (error instanceof Error ? error.message : String(error)));
    return null;
  }
}

/**
 * Verify HMAC signature on incoming request from Job Executor
 * 
 * @param req - The incoming Request object
 * @param payload - The parsed JSON payload (must match what was signed)
 * @returns true if signature is valid and timestamp is fresh
 */
export async function verifyExecutorRequest(req: Request, payload: unknown): Promise<boolean> {
  const sharedSecret = await getSharedSecret();
  
  // If no secret configured, allow requests (backward compatibility)
  // This enables gradual rollout - configure secret when ready
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
