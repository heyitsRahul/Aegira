/** Domain error hierarchy. The API layer maps these to HTTP statuses. */

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class SessionNotFoundError extends DomainError {
  constructor(sessionId: string) {
    super(`session ${sessionId} not found`);
  }
}

/**
 * Thrown for ANY cancel attempt outside PENDING, before the PIN is even
 * looked at — so the error is identical for safe, duress, and wrong PINs
 * and reveals nothing (invariants 3 and 4).
 */
export class CancelNotAllowedError extends DomainError {
  constructor() {
    super('cancellation is only possible before activation');
  }
}

export class InvalidPinError extends DomainError {
  constructor() {
    super('invalid pin');
  }
}

export class ResponderNotAuthorizedError extends DomainError {
  constructor() {
    super('responder is not authorized for this session');
  }
}

export class InvalidArrivalCodeError extends DomainError {
  constructor() {
    super('arrival code does not match');
  }
}

export class LocationRejectedError extends DomainError {
  constructor(state: string) {
    super(`location updates are not accepted in state ${state}`);
  }
}
