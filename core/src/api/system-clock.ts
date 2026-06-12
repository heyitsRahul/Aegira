import { Clock } from '../domain/types';

/**
 * The only place in the codebase that reads the wall clock. Everything
 * below the API composition root receives time via the Clock interface.
 */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
