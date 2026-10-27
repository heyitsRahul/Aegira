import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { DomainErrorFilter } from './domain-error.filter';
import { messagePage } from './lite-views';

/** Paths whose answers can carry session data: never kept in a cache. */
const PRIVATE_PATHS = ['/sessions', '/lite', '/admin', '/dev', '/gateway'];

/**
 * Browser-facing protections, shared by the real server and the HTTP
 * tests so both run the same setup:
 *  - no "X-Powered-By: Express" banner telling attackers what to try;
 *  - pages cannot be framed by another site (a hidden frame over the
 *    cancel or "I'm safe" buttons would be a clickjacking lever);
 *  - no Referer header: contact live links carry their token in the URL,
 *    and it must not leak to a map site the contact taps through to;
 *  - location only for this site's own pages; no camera or microphone;
 *  - answers that can hold session data are never cached;
 *  - one address cannot flood the server with form posts (see postLimiter).
 */
export function configureHttp(
  app: NestExpressApplication,
  options: { postsPerMinute?: number } = {},
): void {
  app.disable('x-powered-by');
  app.useGlobalFilters(new DomainErrorFilter());
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
    if (PRIVATE_PATHS.some((p) => req.path === p || req.path.startsWith(`${p}/`))) {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });
  app.use(postLimiter(options.postsPerMinute ?? POSTS_PER_MINUTE, () => Date.now()));
}

/**
 * Generous on purpose: a person tapping, even a whole class on one college
 * Wi-Fi, never gets near it; a script sending thousands does. The answer
 * still points at 112, because the one who hits it may be in danger.
 */
export const POSTS_PER_MINUTE = 300;
const WINDOW_MS = 60_000;

/**
 * Who is asking. The live demo sits behind Cloudflare, which puts the real
 * visitor address in CF-Connecting-IP and overwrites any value a visitor
 * sends. Without it (local runs), the direct connection address is used.
 * X-Forwarded-For is not used: behind two proxies its last entry is the
 * proxy, which would lump many visitors into one count.
 */
function clientKey(req: Request): string {
  const cloudflare = req.headers['cf-connecting-ip'];
  if (typeof cloudflare === 'string' && cloudflare.length > 0 && cloudflare.length <= 45) {
    return cloudflare;
  }
  return req.socket?.remoteAddress ?? req.ip ?? 'unknown';
}

/**
 * Counts POSTs per client address in one-minute windows. SMS webhooks are
 * exempt: they are signed, and one phone relays everyone's texts.
 */
export function postLimiter(limit: number, now: () => number) {
  let windowStart = now();
  let counts = new Map<string, number>();
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'POST' || req.path.startsWith('/gateway/')) {
      next();
      return;
    }
    if (now() - windowStart >= WINDOW_MS) {
      windowStart = now();
      counts = new Map();
    }
    const key = clientKey(req);
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    if (count > limit) {
      res.setHeader('Retry-After', String(Math.ceil((windowStart + WINDOW_MS - now()) / 1000)));
      res.status(429);
      if (req.path.startsWith('/lite')) {
        // Old phones get a page, not JSON.
        res.type('html').send(messagePage('Please wait a minute', 'Too many tries from this network. In danger? Call 112.'));
      } else {
        res.json({ error: 'too many requests from this network. In danger? Call 112' });
      }
      return;
    }
    next();
  };
}
