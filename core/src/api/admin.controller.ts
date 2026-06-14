import { Controller, Get, Headers, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { InMemoryMetrics } from '../services/metrics';
import { WaitlistService } from '../services/waitlist.service';
import { METRICS, WAITLIST } from './public.controller';
import { NotAuthenticatedError } from '../domain/errors';

export const ADMIN_TOKEN = 'ADMIN_TOKEN';

const PUBLIC_DIR = join(__dirname, '..', '..', 'public');

function tokenMatches(presented: string | undefined, expected: string): boolean {
  if (typeof presented !== 'string' || presented.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}

/**
 * Founder ops dashboard. The HTML page is public (it's just a shell); the
 * data endpoint is gated by an admin token because it returns the one piece
 * of PII in the system that lives outside a session — the marketing
 * waitlist emails. Aggregate metrics carry no PII and could be public, but
 * are returned through the same gate for simplicity.
 */
@Controller('admin')
export class AdminController {
  constructor(
    @Inject(WAITLIST) private readonly waitlist: WaitlistService,
    @Inject(METRICS) private readonly metrics: InMemoryMetrics,
    @Inject(ADMIN_TOKEN) private readonly adminToken: string,
  ) {}

  @Get()
  page(@Res() res: Response): void {
    res.sendFile(join(PUBLIC_DIR, 'admin.html'));
  }

  @Get('data')
  data(@Headers('x-admin-token') token?: string) {
    if (!tokenMatches(token, this.adminToken)) {
      throw new NotAuthenticatedError();
    }
    return {
      metrics: this.metrics.snapshot(),
      waitlist: {
        count: this.waitlist.count(),
        recent: this.waitlist.recent(50).map((e) => ({
          email: e.email,
          country: e.country,
          joinedAt: e.joinedAt,
        })),
      },
    };
  }
}
