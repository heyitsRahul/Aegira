/**
 * The emergency agent's view of the world, and a fake version of it whose
 * tools can be broken on purpose.
 *
 * The agent runs AFTER the deterministic SOS trigger has already alerted every
 * trusted contact. Its job is the work around the emergency: noticing failed
 * alerts, retrying, moving on, keeping people updated. It never starts, ends
 * or cancels an emergency and never picks a helper: those tools don't exist
 * here (CLAUDE.md invariants 2, 3 and 9).
 */
import { Clock } from '../domain/types';

export type ContactRole = 'trusted' | 'backup';

export interface Contact {
  readonly id: string;
  readonly name: string;
  /** Trusted contacts were alerted by the trigger. Backup contacts need a yes (or silence). */
  readonly role: ContactRole;
}

/** What breaks, on purpose. */
export interface FaultPlan {
  /** SMS to these contacts fails this many times before working (Infinity = never works). */
  readonly smsFailures?: Readonly<Record<string, number>>;
  /** GPS gives nothing for the whole run. */
  readonly locationUnavailable?: boolean;
  /** These contacts get the message but never respond. */
  readonly unreachable?: readonly string[];
  /** These contacts reply with this text (used for the prompt-injection test). */
  readonly replies?: Readonly<Record<string, string>>;
  /** How the user answers an ask: 'yes', 'no', or 'silent' (can't answer). */
  readonly userAnswer?: 'yes' | 'no' | 'silent';
  /** The duress PIN was used: the phone must show nothing that hints otherwise. */
  readonly duress?: boolean;
}

export interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly contacts: readonly Contact[];
  /** Place in the user's own words, used when GPS fails. */
  readonly placeWords?: string;
  readonly faults: FaultPlan;
}

export type Effect =
  | { kind: 'sms'; to: string; template: string; ok: boolean; at: number }
  | { kind: 'user_notice'; template: string; shown: boolean; at: number }
  | { kind: 'ask'; question: string; answer: 'yes' | 'no' | 'silent'; at: number }
  | { kind: 'dialer_opened'; number: '112'; at: number };

export interface ToolOutcome {
  readonly ok: boolean;
  readonly data?: Record<string, unknown>;
  readonly error?: string;
}

/** A world where every tool can be made to fail. Records every side effect. */
export class FakeWorld {
  readonly effects: Effect[] = [];
  private readonly smsAttempts = new Map<string, number>();

  constructor(
    readonly scenario: Scenario,
    private readonly clock: Clock,
  ) {
    // The trigger's own first alerts count as attempt #1.
    for (const c of scenario.contacts) {
      if (c.role === 'trusted') this.smsAttempts.set(c.id, 1);
    }
  }

  /** Did the trigger's own first alert to this trusted contact fail? */
  initialFailed(id: string): boolean {
    return this.contact(id)?.role === 'trusted' && (this.scenario.faults.smsFailures?.[id] ?? 0) >= 1;
  }

  contact(id: string): Contact | undefined {
    return this.scenario.contacts.find((c) => c.id === id);
  }

  private t(): number {
    return this.clock.now().getTime();
  }

  sendSms(contactId: string, template: string): ToolOutcome {
    const n = (this.smsAttempts.get(contactId) ?? 0) + 1;
    this.smsAttempts.set(contactId, n);
    const failures = this.scenario.faults.smsFailures?.[contactId] ?? 0;
    // Attempt n succeeds once the planned failures are used up.
    const ok = n > failures;
    this.effects.push({ kind: 'sms', to: contactId, template, ok, at: this.t() });
    return ok ? { ok: true, data: { delivered: true } } : { ok: false, error: 'sms_gateway_error' };
  }

  location(): ToolOutcome {
    if (this.scenario.faults.locationUnavailable) {
      return this.scenario.placeWords
        ? { ok: false, error: 'gps_unavailable', data: { placeWords: this.scenario.placeWords } }
        : { ok: false, error: 'gps_unavailable' };
    }
    return { ok: true, data: { link: 'live-location-link' } };
  }

  contactStatus(contactId: string): ToolOutcome {
    const delivered = this.effects.some((e) => e.kind === 'sms' && e.to === contactId && e.ok)
      || (this.contact(contactId)?.role === 'trusted' && !this.initialFailed(contactId));
    if (!delivered) return { ok: true, data: { status: 'not_delivered' } };
    if (this.scenario.faults.unreachable?.includes(contactId)) return { ok: true, data: { status: 'no_response' } };
    const reply = this.scenario.faults.replies?.[contactId];
    return { ok: true, data: reply ? { status: 'replied', reply } : { status: 'acknowledged' } };
  }

  /** Shows a notice on the user's phone. Under duress nothing is shown (invariant 4). */
  notifyUser(template: string): ToolOutcome {
    const shown = !this.scenario.faults.duress;
    this.effects.push({ kind: 'user_notice', template, shown, at: this.t() });
    return { ok: true };
  }

  ask(question: string): 'yes' | 'no' | 'silent' {
    // Under duress the phone is in someone else's hands: never ask on it.
    const answer = this.scenario.faults.duress ? 'silent' : this.scenario.faults.userAnswer ?? 'silent';
    this.effects.push({ kind: 'ask', question, answer, at: this.t() });
    return answer;
  }

  openDialer(): void {
    this.effects.push({ kind: 'dialer_opened', number: '112', at: this.t() });
  }

  /** Has at least one trusted or backup contact received an alert? */
  reachedContacts(): string[] {
    const ids = new Set<string>();
    for (const c of this.scenario.contacts) {
      if (c.role === 'trusted' && !this.initialFailed(c.id)) ids.add(c.id);
    }
    for (const e of this.effects) if (e.kind === 'sms' && e.ok) ids.add(e.to);
    return [...ids];
  }
}
