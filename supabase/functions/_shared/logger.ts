/**
 * Centralized logger with log level control for edge functions.
 * 
 * Set LOG_LEVEL environment variable to control verbosity:
 * - debug: All logs (development only)
 * - info: Info, warn, error (default)
 * - warn: Warn and error only
 * - error: Errors only (recommended for production)
 * 
 * SECURITY: Never log passwords, tokens, usernames, email addresses, or IP addresses.
 * Use generic messages like "Authentication successful" instead of "User john@example.com authenticated".
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL = (Deno.env.get('LOG_LEVEL') || 'info').toLowerCase() as LogLevel;
const levels: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const currentLevel = levels[LOG_LEVEL] ?? levels.info;

export const logger = {
  /**
   * Debug level - development only, never in production
   * Use for detailed flow tracing that would be too verbose normally
   */
  debug: (msg: string, ...args: unknown[]) => {
    if (currentLevel <= levels.debug) {
      console.debug(`[DEBUG] ${msg}`, ...args);
    }
  },

  /**
   * Info level - general operational messages
   * Use for: "Job completed", "Request processed", "Cache refreshed"
   * NEVER use for: usernames, emails, IPs, job details, server names
   */
  info: (msg: string, ...args: unknown[]) => {
    if (currentLevel <= levels.info) {
      console.log(`[INFO] ${msg}`, ...args);
    }
  },

  /**
   * Warn level - potential issues that don't prevent operation
   * Use for: "Retry attempt 2/3", "Deprecated API called", "Rate limit approaching"
   */
  warn: (msg: string, context?: Record<string, unknown>) => {
    if (currentLevel <= levels.warn) {
      // Sanitize context to avoid logging sensitive data
      const safeContext = context ? sanitizeContext(context) : '';
      console.warn(`[WARN] ${msg}`, safeContext);
    }
  },

  /**
   * Error level - always logged, indicates failure
   * Use generic error categories, never log full stack traces in production
   */
  error: (msg: string, errorCode?: string) => {
    // Errors are always logged regardless of level
    console.error(`[ERROR] ${msg}${errorCode ? ` (${errorCode})` : ''}`);
  },

  /**
   * Security event - always logged, for audit trail
   * Use for: auth attempts, permission checks, security-relevant actions
   */
  security: (event: string, success: boolean) => {
    console.log(`[SECURITY] ${event}: ${success ? 'OK' : 'DENIED'}`);
  }
};

/**
 * Sanitize context object to remove sensitive fields
 */
function sanitizeContext(context: Record<string, unknown>): string {
  const sensitiveKeys = [
    'password', 'token', 'secret', 'key', 'auth', 'credential',
    'username', 'user_name', 'email', 'ip', 'ip_address',
    'idm_uid', 'user_dn', 'principal'
  ];
  
  const sanitized: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(context)) {
    const keyLower = key.toLowerCase();
    if (sensitiveKeys.some(sk => keyLower.includes(sk))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      // Don't deep-serialize complex objects
      sanitized[key] = '[object]';
    } else {
      sanitized[key] = value;
    }
  }
  
  return JSON.stringify(sanitized);
}

export default logger;
