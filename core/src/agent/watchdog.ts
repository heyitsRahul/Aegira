/**
 * The watchdog is plain code, not AI. It exists so that silent failure is
 * impossible by design instead of depending on the model behaving.
 *
 * Every failure opens a ticket. A ticket closes when the user is told
 * (tell_user) after the failure. If a ticket is still open after the
 * deadline, the watchdog tells the user itself and records that the agent
 * failed to. At the end of a run, every open ticket is forced the same way,
 * and "nobody was reached and nobody said so" counts as a failure too.
 */
import { Clock } from '../domain/types';
import { FakeWorld } from './world';

export const WATCHDOG_DEADLINE_MS = 30_000;

export interface Ticket {
  readonly what: string;
  readonly openedAt: number;
  closedAt?: number;
  closedBy?: 'agent' | 'watchdog';
}

export class Watchdog {
  readonly tickets: Ticket[] = [];

  constructor(
    private readonly world: FakeWorld,
    private readonly clock: Clock,
    private readonly deadlineMs = WATCHDOG_DEADLINE_MS,
  ) {}

  private now(): number {
    return this.clock.now().getTime();
  }

  failure(what: string): void {
    // One open ticket per thing is enough.
    if (this.tickets.some((t) => t.what === what && t.closedAt === undefined)) return;
    this.tickets.push({ what, openedAt: this.now() });
  }

  userTold(): void {
    const now = this.now();
    for (const t of this.tickets) {
      if (t.closedAt === undefined) { t.closedAt = now; t.closedBy = 'agent'; }
    }
  }

  /** Call after every agent step. */
  check(): void {
    const now = this.now();
    const overdue = this.tickets.filter((t) => t.closedAt === undefined && now - t.openedAt > this.deadlineMs);
    if (overdue.length) this.fire(overdue);
  }

  /** Call when the run ends, however it ends. */
  final(): void {
    const open = this.tickets.filter((t) => t.closedAt === undefined);
    if (open.length) this.fire(open);
    if (this.world.reachedContacts().length === 0) {
      const toldNobody = this.world.effects.some((e) => e.kind === 'user_notice' && e.template === 'nobody_reached_yet');
      if (!toldNobody) {
        const t: Ticket = { what: 'nobody_reached', openedAt: this.now() };
        this.tickets.push(t);
        this.fire([t], 'nobody_reached_yet');
      }
    }
  }

  private fire(tickets: Ticket[], template = 'watchdog_problem_alert'): void {
    this.world.notifyUser(template);
    const now = this.now();
    for (const t of tickets) { t.closedAt = now; t.closedBy = 'watchdog'; }
  }

  openTickets(): Ticket[] {
    return this.tickets.filter((t) => t.closedAt === undefined);
  }

  /** Failures the agent never told the user about (the watchdog had to). */
  silentFailures(): Ticket[] {
    return this.tickets.filter((t) => t.closedBy === 'watchdog');
  }
}
