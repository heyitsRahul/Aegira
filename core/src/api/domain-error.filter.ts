import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import {
  ActiveSessionExistsError,
  ArrivalCodeLockedError,
  CancelNotAllowedError,
  InvalidArrivalCodeError,
  InvalidInputError,
  InvalidPinError,
  LocationUnknownError,
  NotAuthenticatedError,
  ResponderNotAuthorizedError,
  SessionNotFoundError,
  WatchActionNotAllowedError,
} from '../domain/errors';
import { IllegalTransitionError } from '../domain/state-machine';

/**
 * Maps domain errors to HTTP statuses so controllers stay logic-free.
 * Unknown errors become an opaque 500 — internals never leak to clients.
 */
@Catch()
export class DomainErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    if (exception instanceof SessionNotFoundError) {
      response.status(404).json({ error: exception.message });
      return;
    }
    if (exception instanceof NotAuthenticatedError) {
      response.status(401).json({ error: exception.message });
      return;
    }
    if (exception instanceof InvalidInputError) {
      response.status(400).json({ error: exception.message });
      return;
    }
    if (
      exception instanceof InvalidPinError ||
      exception instanceof InvalidArrivalCodeError ||
      exception instanceof ArrivalCodeLockedError ||
      exception instanceof ResponderNotAuthorizedError
    ) {
      response.status(403).json({ error: exception.message });
      return;
    }
    if (
      exception instanceof CancelNotAllowedError ||
      exception instanceof IllegalTransitionError ||
      exception instanceof ActiveSessionExistsError ||
      exception instanceof WatchActionNotAllowedError ||
      exception instanceof LocationUnknownError
    ) {
      response.status(409).json({ error: exception.message });
      return;
    }
    // The request reader's own errors (body too large, unreadable body)
    // carry a 4xx status: they are the caller's mistake, not ours.
    const status = (exception as { status?: unknown } | null)?.status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      response.status(status).json({ error: status === 413 ? 'request too large' : 'bad request' });
      return;
    }
    response.status(500).json({ error: 'internal error' });
  }
}
