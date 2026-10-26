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
  /** Comma-separated list of superadmin emails seeded/allowed bootstrap. */
  SUPERADMIN_EMAILS: z.string().default(''),
  /** When true, "email" delivery is logged to console (dev); never a claim of delivery. */
  EMAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),
  SMTP_URL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
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
