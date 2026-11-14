import { z } from 'zod';

/**
 * Validated environment configuration (spec §1.16 — validate all external inputs,
 * including our own process environment, at startup).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** 32+ byte random string; session tokens are hashed, this signs cookies. */
  SESSION_SECRET: z.string().min(32).default('dev-only-session-secret-change-me-32bytes!!'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  /** Public web app origin used in emailed links; defaults to the first CORS origin. */
  WEB_APP_URL: z.string().url().optional(),
  /** Comma-separated list of superadmin emails seeded/allowed bootstrap. */
  SUPERADMIN_EMAILS: z.string().default(''),
  /** When true, "email" delivery is logged to console (dev); never a claim of delivery. */
  EMAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),
  /** Razorpay credentials; online plan payment is disabled (503) when unset. */
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  /** Secret set on the Razorpay webhook; the webhook endpoint returns 503 when unset. */
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  SMTP_URL: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  /** Display name for the From header; the address is SMTP_USER unless SMTP_FROM_ADDRESS is set. */
  SMTP_FROM_NAME: z.string().default('MediCore'),
  SMTP_FROM_ADDRESS: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (parsed.success && parsed.data.EMAIL_TRANSPORT === 'smtp') {
    const d = parsed.data;
    if (!d.SMTP_URL && !(d.SMTP_HOST && d.SMTP_USER && d.SMTP_PASS)) {
      throw new Error('Invalid environment configuration — EMAIL_TRANSPORT=smtp needs SMTP_URL or SMTP_HOST, SMTP_USER and SMTP_PASS');
    }
  }
  if (!parsed.success) {
    // Fail fast with the specific missing/invalid variables.
    const details = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration — ${details}`);
  }
  cached = parsed.data;
  return cached;
}
