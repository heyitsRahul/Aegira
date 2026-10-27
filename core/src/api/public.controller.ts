import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { InMemoryMetrics } from '../services/metrics';
import { WaitlistService } from '../services/waitlist.service';

export const WAITLIST = 'WAITLIST';
export const METRICS = 'METRICS';

/**
 * Indian languages we plan to add next. People tap the one they want; we
 * count taps per language (a plain counter, no identity) to decide the order.
 */
export const UPCOMING_LANGUAGES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'bn', name: 'বাংলা' },
  { code: 'mr', name: 'मराठी' },
  { code: 'te', name: 'తెలుగు' },
  { code: 'ta', name: 'தமிழ்' },
  { code: 'gu', name: 'ગુજરાતી' },
  { code: 'ur', name: 'اردو' },
  { code: 'kn', name: 'ಕನ್ನಡ' },
  { code: 'or', name: 'ଓଡ଼ିଆ' },
  { code: 'ml', name: 'മലയാളം' },
  { code: 'pa', name: 'ਪੰਜਾਬੀ' },
  { code: 'as', name: 'অসমীয়া' },
];

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

  /** Liveness probe for the hosting platform. */
  @Get('healthz')
  health() {
    return { ok: true };
  }

  @Get('languages')
  languages() {
    return { available: ['en', 'hi'], upcoming: UPCOMING_LANGUAGES };
  }

  /** "I want my language": counts one vote. Unknown codes are ignored. */
  @Post('languages/vote')
  @HttpCode(200)
  voteLanguage(@Body() body: { code?: string }) {
    const known = UPCOMING_LANGUAGES.some((l) => l.code === body?.code);
    if (known) {
      this.metrics.increment(`language.vote.${body.code}`);
    }
    return { ok: known };
  }

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
