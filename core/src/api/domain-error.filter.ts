import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import {
  CancelNotAllowedError,
  InvalidArrivalCodeError,
  InvalidPinError,
  ResponderNotAuthorizedError,
  SessionNotFoundError,
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
    if (
      exception instanceof InvalidPinError ||
      exception instanceof InvalidArrivalCodeError ||
      exception instanceof ResponderNotAuthorizedError
    ) {
      response.status(403).json({ error: exception.message });
      return;
    }
    if (
      exception instanceof CancelNotAllowedError ||
      exception instanceof IllegalTransitionError
    ) {
      response.status(409).json({ error: exception.message });
      return;
    }
    response.status(500).json({ error: 'internal error' });
  }
}
