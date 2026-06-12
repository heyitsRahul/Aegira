import {
  ActiveSessionExistsError,
  CancelNotAllowedError,
  InvalidInputError,
  InvalidPinError,
} from '../domain/errors';
import { SessionCategory, SessionState } from '../domain/types';
import { ResponderProfile } from './matching.service';
import { normalizePhone, RegistrationService } from './registration.service';
import { SessionService } from './session.service';

/**
 * The SMS command channel: everything a help seeker needs on a phone that
 * has neither apps nor a browser. Commands (case-insensitive):
 *
 *   REG <name> <contact-phone> <safe-pin> <duress-pin>   register
 *   SOS [M|A|O]                                          trigger (M edical,
 *                                                        A ccident, O ther)
 *   CANCEL <pin>                                         cancel in window
 *   STATUS                                               masked status
 *   SAFE <pin>                                           resolve
 *   SEND                                                 (contacts) dispatch
 *   STOP                                                 delete registration
 *
 * Duress discipline: the reply to CANCEL is one constant string for both
 * PINs, and STATUS replies are computed from the masked clientStatus —
 * nothing on the wire distinguishes a duress session.
 *
 * Location enters only WITH the SOS trigger, from the carrier-supplied
 * approximate position on the inbound webhook (invariant 1: nothing about
 * a registration ever stores where someone is).
 */

const CATEGORY_BY_LETTER: Readonly<Record<string, SessionCategory>> = {
  M: 'medical',
  A: 'accident',
  O: 'other',
  S: 'personal_safety',
};

const HELP_TEXT =
  'Sahay commands: REG name contact-phone safe-pin duress-pin | SOS | ' +
  'CANCEL pin | STATUS | SAFE pin | SEND (contacts) | STOP';

const CANCELLED_REPLY = 'Sahay: session cancelled. Nobody was notified.';
const WRONG_PIN_REPLY = 'Sahay: wrong PIN.';
const NO_SESSION_REPLY = 'Sahay: no active session.';

const STATUS_TEXT: Readonly<Record<SessionState, string>> = {
  PENDING: 'Sahay: SOS received, activating shortly. Text CANCEL <pin> to stop it.',
  ACTIVE: 'Sahay: your circle is alerted. Help is in motion.',
  DISPATCHED: 'Sahay: a verified responder is on the way.',
  ARRIVED: 'Sahay: your responder is with you.',
  RESOLVED: 'Sahay: session resolved. Stay safe.',
  CANCELLED: NO_SESSION_REPLY,
  CLOSED: NO_SESSION_REPLY,
  PURGED: NO_SESSION_REPLY,
};

export class SmsGatewayService {
  constructor(
    private readonly sessions: SessionService,
    private readonly registrations: RegistrationService,
    private readonly roster: () => readonly ResponderProfile[],
  ) {}

  /**
   * Handles one inbound SMS. `approxLocation` is the carrier's coarse
   * network position forwarded by the SMS provider webhook; it is used
   * only when an SOS creates a session.
   */
  async handle(
    from: string,
    text: string,
    approxLocation?: { lat: number; lng: number },
  ): Promise<string> {
    const parts = text.trim().split(/\s+/);
    const command = (parts[0] ?? '').toUpperCase();
    try {
      switch (command) {
        case 'REG':
          return this.handleRegister(from, parts.slice(1));
        case 'SOS':
          return this.handleSos(from, parts[1], approxLocation);
        case 'CANCEL':
          return await this.handleCancel(from, parts[1] ?? '');
        case 'STATUS':
          return this.handleStatus(from);
        case 'SAFE':
          return this.handleSafe(from, parts[1] ?? '');
        case 'SEND':
          return await this.handleSend(from);
        case 'STOP':
          return this.registrations.unregister(from)
            ? 'Sahay: registration deleted. Text REG to start again.'
            : HELP_TEXT;
        default:
          return HELP_TEXT;
      }
    } catch (error) {
      if (error instanceof InvalidInputError) {
        return `Sahay: ${error.message}.`;
      }
      throw error;
    }
  }

  private handleRegister(from: string, args: string[]): string {
    if (args.length < 4) {
      return 'Sahay: text REG <name> <contact-phone> <safe-pin> <duress-pin>. Use _ for spaces in the name.';
    }
    const [name, contactPhone, pinSafe, pinDuress] = args;
    const record = this.registrations.register(
      from,
      name.replace(/_/g, ' '),
      contactPhone,
      pinSafe,
      pinDuress,
    );
    return (
      `Sahay: registered as ${record.displayName} (consent ${record.consentVersion}). ` +
      'Text SOS to trigger help. Text STOP to delete this registration.'
    );
  }

  private handleSos(
    from: string,
    categoryLetter: string | undefined,
    approxLocation?: { lat: number; lng: number },
  ): string {
    const registration = this.registrations.find(from);
    if (registration === undefined) {
      return 'Sahay: not registered. Text REG <name> <contact-phone> <safe-pin> <duress-pin> first.';
    }
    if (approxLocation === undefined) {
      return 'Sahay: your network position is unavailable. Try again, or call your trusted contact.';
    }
    try {
      const receipt = this.sessions.trigger({
        userId: registration.phoneRef,
        displayName: registration.displayName,
        contacts: registration.contacts,
        location: approxLocation,
        category: CATEGORY_BY_LETTER[(categoryLetter ?? 'S').toUpperCase()] ?? 'personal_safety',
        pinHashes: { safe: registration.pinSafeHash, duress: registration.pinDuressHash },
      });
      const seconds = Math.round(receipt.activationCountdownMs / 1000);
      return (
        `Sahay: SOS received. Your circle will be alerted in ${seconds}s. ` +
        'Text CANCEL <pin> to stop it.'
      );
    } catch (error) {
      if (error instanceof ActiveSessionExistsError) {
        return 'Sahay: you already have a session running. Text STATUS.';
      }
      throw error;
    }
  }

  private async handleCancel(from: string, pin: string): Promise<string> {
    const registration = this.registrations.find(from);
    const sessionId =
      registration === undefined
        ? null
        : this.sessions.latestSessionIdForUser(registration.phoneRef);
    if (sessionId === null) {
      return NO_SESSION_REPLY;
    }
    try {
      await this.sessions.cancel(sessionId, pin);
      // One constant reply for safe AND duress cancels (invariant 4).
      return CANCELLED_REPLY;
    } catch (error) {
      if (error instanceof InvalidPinError) {
        return WRONG_PIN_REPLY;
      }
      if (error instanceof CancelNotAllowedError) {
        return 'Sahay: this session is live and can no longer be cancelled.';
      }
      throw error;
    }
  }

  private handleStatus(from: string): string {
    const registration = this.registrations.find(from);
    const sessionId =
      registration === undefined
        ? null
        : this.sessions.latestSessionIdForUser(registration.phoneRef);
    if (sessionId === null) {
      return NO_SESSION_REPLY;
    }
    // clientStatus is the masked view — duress sessions read as cancelled.
    return STATUS_TEXT[this.sessions.clientStatus(sessionId).state];
  }

  private handleSafe(from: string, pin: string): string {
    // Resolution requires the SAFE pin specifically. A duress PIN here
    // behaves exactly like any wrong PIN: plausible deniability for a
    // victim forced to send "all clear". (Duress-resolve semantics are a
    // tracked design item, §9.)
    if (this.registrations.verifyPin(from, pin) !== 'safe') {
      return WRONG_PIN_REPLY;
    }
    const registration = this.registrations.find(from);
    const sessionId =
      registration === undefined
        ? null
        : this.sessions.latestSessionIdForUser(registration.phoneRef);
    if (sessionId === null) {
      return NO_SESSION_REPLY;
    }
    const state = this.sessions.opsView(sessionId).state;
    if (state !== 'ACTIVE' && state !== 'DISPATCHED' && state !== 'ARRIVED') {
      return NO_SESSION_REPLY;
    }
    this.sessions.resolve(sessionId);
    return 'Sahay: marked safe. Session resolved. Take care.';
  }

  private async handleSend(from: string): Promise<string> {
    const address = normalizePhone(from);
    const sessionIds = this.sessions.dispatchableSessionIdsForContact(address);
    if (sessionIds.length === 0) {
      return 'Sahay: nothing to dispatch right now.';
    }
    for (const sessionId of sessionIds) {
      await this.sessions.dispatch(sessionId, this.roster());
    }
    return 'Sahay: verified responders have been asked to help.';
  }
}
