/**
 * Runtime configuration resolved from the environment. Pure (takes the env
 * as an argument) so the production-safety rules below are unit-tested.
 *
 * Env vars are AEGIRA_*; the pre-rename SAHAY_* names are still honoured so
 * existing deployments keep working.
 *
 * Production rules (NODE_ENV=production):
 *  - no dev defaults for secrets: an unset admin token locks the founder
 *    dashboard, an unset gateway secret closes the JSON SMS webhook;
 *  - nothing else changes — demo mode is a separate switch.
 *
 * Demo mode (AEGIRA_DEMO, on unless set to "off"): exposes the simulator and
 * ops surfaces (/console, /phone, /dev/*) and never sends real SMS, so a
 * public demo cannot be used to text arbitrary phone numbers.
 */
import { timingSafeEqual } from 'node:crypto';

export interface RuntimeConfig {
  production: boolean;
  demoMode: boolean;
  baseUrl: string;
  dbPath: string | null;
  adminToken: string | null;
  gatewaySecret: string | null;
  /** The number people text, shown in guides (display only). */
  smsNumber: string | null;
}

export const DEV_ADMIN_TOKEN = 'dev-admin-token';
export const DEV_GATEWAY_SECRET = 'dev-gateway-secret';

type Env = Readonly<Record<string, string | undefined>>;

function read(env: Env, name: string): string | undefined {
  const value = env[`AEGIRA_${name}`] ?? env[`SAHAY_${name}`];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

/** Constant-time secret check. An unconfigured (null) secret never matches. */
export function tokenMatches(presented: string | undefined, expected: string | null): boolean {
  if (expected === null || typeof presented !== 'string' || presented.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}

export function resolveRuntimeConfig(env: Env): RuntimeConfig {
  const production = env.NODE_ENV === 'production';
  return {
    production,
    demoMode: read(env, 'DEMO')?.toLowerCase() !== 'off',
    // Render injects its public URL; an explicit AEGIRA_BASE_URL wins.
    baseUrl: read(env, 'BASE_URL') ?? env.RENDER_EXTERNAL_URL ?? 'http://localhost:3000',
    dbPath: read(env, 'DB') ?? null,
    adminToken: read(env, 'ADMIN_TOKEN') ?? (production ? null : DEV_ADMIN_TOKEN),
    gatewaySecret: read(env, 'GATEWAY_SECRET') ?? (production ? null : DEV_GATEWAY_SECRET),
    smsNumber: read(env, 'SMS_NUMBER') ?? null,
  };
}
