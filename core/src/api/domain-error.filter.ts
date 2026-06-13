import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import {
  ActiveSessionExistsError,
  ArrivalCodeLockedError,
  CancelNotAllowedError,
  InvalidArrivalCodeError,
  InvalidInputError,
  InvalidPinError,
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
      exception instanceof WatchActionNotAllowedError
    ) {
      response.status(409).json({ error: exception.message });
      return;
    }
    response.status(500).json({ error: 'internal error' });
  }
}
