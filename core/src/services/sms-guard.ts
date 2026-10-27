import { createHash } from 'node:crypto';
import { Clock } from '../domain/types';
import { Metrics, NoopMetrics } from './metrics';
import { SmsTransport } from './sms';

/**
 * Outbound guard for REAL SMS from a public demo. Anyone can open the demo
 * and type any phone number as their "trusted contact", so without a guard
 * the demo could be used to text strangers, and a small SIM gateway could
 * get its number blocked by the carrier.
 *
 *  - Alerts go only to numbers that agreed: they texted JOIN (consent v6) or
 *    registered themselves (consent v4). Replies to someone who just texted
 *    us are always allowed — they started the conversation.
 *  - Daily caps per number and in total bound the damage of any mistake.
 *
 * Counters live in memory, keyed by a hash of the number, and reset each
 * UTC day. Blocked sends are counted (never logged with the number).
 */
export interface SmsLimits {
  perNumberPerDay: number;
  totalPerDay: number;
}

/**
 * Indian prepaid "unlimited" SMS packs typically stop at 100 texts a day per
 * SIM, so the total stays within what one gateway phone can actually send.
 */
export const DEMO_SMS_LIMITS: SmsLimits = { perNumberPerDay: 20, totalPerDay: 100 };

export type SmsKind = 'alert' | 'reply';

const hashOf = (to: string): string => createHash('sha256').update(to).digest('hex');

export class SmsGuard {
  private day = '';
  private total = 0;
  private readonly perNumber = new Map<string, number>();

  constructor(
    private readonly clock: Clock,
    private readonly limits: SmsLimits,
    /** True if this destination agreed to receive alerts. */
    private readonly mayReceiveAlerts: (to: string) => boolean,
    private readonly metrics: Metrics = new NoopMetrics(),
  ) {}

  allow(to: string, kind: SmsKind): boolean {
    const today = this.clock.now().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.total = 0;
      this.perNumber.clear();
    }
    if (kind === 'alert' && !this.mayReceiveAlerts(to)) {
      this.metrics.increment('sms.blocked_not_opted_in');
      return false;
    }
    const key = hashOf(to);
    const sentToNumber = this.perNumber.get(key) ?? 0;
    if (this.total >= this.limits.totalPerDay || sentToNumber >= this.limits.perNumberPerDay) {
      this.metrics.increment('sms.blocked_daily_cap');
      return false;
    }
    this.total += 1;
    this.perNumber.set(key, sentToNumber + 1);
    this.metrics.increment('sms.sent');
    return true;
  }
}

/** A real transport behind the guard. One per kind, sharing one guard. */
export class GuardedSmsTransport implements SmsTransport {
  constructor(
    private readonly inner: SmsTransport,
    private readonly guard: SmsGuard,
    private readonly kind: SmsKind,
  ) {}

  async send(to: string, text: string, sentAt: string): Promise<void> {
    if (this.guard.allow(to, this.kind)) {
      await this.inner.send(to, text, sentAt);
    }
  }
}
