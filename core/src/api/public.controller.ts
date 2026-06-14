import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { InMemoryMetrics } from '../services/metrics';
import { WaitlistService } from '../services/waitlist.service';

export const WAITLIST = 'WAITLIST';
export const METRICS = 'METRICS';

/**
 * Public, no-session endpoints: the pre-launch waitlist and aggregate,
 * PII-free product metrics. Neither touches session data, identity, or
 * location.
 */
@Controller()
export class PublicController {
  constructor(
    @Inject(WAITLIST) private readonly waitlist: WaitlistService,
    @Inject(METRICS) private readonly metrics: InMemoryMetrics,
  ) {}

  @Post('waitlist')
  join(@Body() body: { email: string; country?: string }) {
    return this.waitlist.join(body.email, body.country);
  }

  @Get('waitlist/count')
  count() {
    return { count: this.waitlist.count() };
  }

  /** Aggregate counters only — no identifiers, ever (see services/metrics). */
  @Get('metrics')
  snapshot() {
    return { metrics: this.metrics.snapshot(), waitlist: this.waitlist.count() };
  }
}
