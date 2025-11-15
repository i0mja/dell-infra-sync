import { z } from 'zod';

/**
 * Validation schemas for security-critical user inputs
 * All inputs must be validated both client-side and server-side
 */

// IP Address validation (supports single IPs and CIDR ranges)
const ipAddressRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
const cidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\/(?:[0-9]|[12][0-9]|3[0-2])$/;

export const ipAddressSchema = z.string()
  .trim()
  .refine((val) => ipAddressRegex.test(val) || cidrRegex.test(val), {
    message: "Must be a valid IP address (e.g., 192.168.1.10) or CIDR range (e.g., 192.168.1.0/24)"
  });

// Hostname validation (RFC 1123)
export const hostnameSchema = z.string()
  .trim()
  .max(255, "Hostname must be less than 255 characters")
  .regex(/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/, {
    message: "Must be a valid hostname"
  })
  .optional()
  .or(z.literal(''));

// Server schema
export const serverSchema = z.object({
  ip_address: ipAddressSchema,
  hostname: hostnameSchema,
  notes: z.string().trim().max(1000, "Notes must be less than 1000 characters").optional().or(z.literal('')),
});

// Credential schema
export const credentialSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name must be less than 100 characters"),
  username: z.string().trim().min(1, "Username is required").max(255, "Username must be less than 255 characters"),
  password: z.string().min(1, "Password is required").max(255, "Password must be less than 255 characters"),
  description: z.string().trim().max(500, "Description must be less than 500 characters").optional().or(z.literal('')),
});

// IP Range schema (for credential mapping)
export const ipRangeSchema = z.object({
  ip_range: z.string().trim().refine((val) => cidrRegex.test(val), {
    message: "Must be a valid CIDR range (e.g., 192.168.1.0/24)"
  }),
  description: z.string().trim().max(500, "Description must be less than 500 characters").optional().or(z.literal('')),
  priority: z.number().int().min(0).max(1000).optional(),
});

// Email validation
export const emailSchema = z.string().trim().email("Must be a valid email address").max(255);

// URL validation
export const urlSchema = z.string().trim().url("Must be a valid URL").max(2048);

// SMTP settings schema
export const smtpSettingsSchema = z.object({
  smtp_host: z.string().trim().min(1, "SMTP host is required").max(255),
  smtp_port: z.number().int().min(1).max(65535, "Port must be between 1 and 65535"),
  smtp_user: z.string().trim().max(255).optional().or(z.literal('')),
  smtp_password: z.string().max(255).optional().or(z.literal('')),
  smtp_from_email: emailSchema.optional().or(z.literal('')),
});

// vCenter settings schema
export const vcenterSettingsSchema = z.object({
  host: z.string().trim().min(1, "vCenter host is required").max(255),
  port: z.number().int().min(1).max(65535, "Port must be between 1 and 65535"),
  username: z.string().trim().min(1, "Username is required").max(255),
  password: z.string().min(1, "Password is required").max(255),
  verify_ssl: z.boolean(),
  sync_enabled: z.boolean(),
});

// Job creation validation
export const jobTargetScopeSchema = z.object({
  server_ids: z.array(z.string().uuid()).optional(),
  all_servers: z.boolean().optional(),
  vcenter_host_ids: z.array(z.string().uuid()).optional(),
}).refine(
  (data) => data.server_ids?.length || data.all_servers || data.vcenter_host_ids?.length,
  { message: "Must specify at least one target (servers, all servers, or vCenter hosts)" }
);

export const jobDetailsSchema = z.record(z.unknown()).refine(
  (data) => {
    // Limit size of details object
    const str = JSON.stringify(data);
    return str.length <= 10000; // 10KB limit
  },
  { message: "Job details must be less than 10KB" }
);

// Network settings validation
export const networkSettingsSchema = z.object({
  connection_timeout_seconds: z.number().int().min(1).max(300),
  read_timeout_seconds: z.number().int().min(1).max(600),
  operation_timeout_seconds: z.number().int().min(1).max(3600),
  max_retry_attempts: z.number().int().min(0).max(10),
  retry_delay_seconds: z.number().int().min(1).max(60),
  max_concurrent_connections: z.number().int().min(1).max(50),
  max_requests_per_minute: z.number().int().min(1).max(1000),
  latency_alert_threshold_ms: z.number().int().min(100).max(10000),
});

/**
 * Sanitizes a string by removing potentially dangerous characters
 * Use this for display purposes, not for validation
 */
export function sanitizeString(input: string): string {
  return input
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .trim();
}

/**
 * Validates and sanitizes user input
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @returns Validated and parsed data
 * @throws ZodError if validation fails
 */
export function validateInput<T>(schema: z.ZodType<T>, data: unknown): T {
  return schema.parse(data);
}

/**
 * Type-safe validation that returns errors instead of throwing
 */
export function safeValidateInput<T>(
  schema: z.ZodType<T>,
  data: unknown
): { success: true; data: T } | { success: false; errors: string[] } {
  const result = schema.safeParse(data);
  
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  return {
    success: false,
    errors: result.error.errors.map((err) => `${err.path.join('.')}: ${err.message}`),
  };
}
