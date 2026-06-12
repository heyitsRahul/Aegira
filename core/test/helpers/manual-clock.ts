import { Clock } from '../../src/domain/types';

/** Deterministic clock for tests: time moves only when told to. */
export class ManualClock implements Clock {
  private currentMs: number;

  constructor(start: Date) {
    this.currentMs = start.getTime();
  }

  now(): Date {
    return new Date(this.currentMs);
  }

  advance(ms: number): void {
    this.currentMs += ms;
  }
}
