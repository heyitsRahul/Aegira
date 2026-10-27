import {
  ActiveSessionExistsError,
  CancelNotAllowedError,
  InvalidInputError,
  InvalidPinError,
  LocationUnknownError,
  WatchActionNotAllowedError,
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
 *   SOS [M|A|O] [place]                                  trigger (M edical,
 *                                                        A ccident, O ther),
 *                                                        e.g. SOS near Andheri
 *   WATCH <minutes> [place]                              arm a journey watch
 *   EXTEND <minutes>                                     push the watch out
 *   CANCEL <pin>                                         cancel in window
 *   STATUS                                               masked status
 *   SAFE <pin>                                           check in / resolve
 *   SEND                                                 (contacts) dispatch
 *   STOP                                                 delete registration
 *
 * Duress discipline: the reply to CANCEL is one constant string for both
 * PINs; SAFE on a journey watch likewise replies identically for safe and
 * duress check-ins while a duress check-in silently escalates; and STATUS
 * replies are computed from the masked clientStatus — nothing on the wire
 * distinguishes a duress session (invariant 4).
 *
 * Location enters only WITH the SOS trigger, from the carrier-supplied
 * approximate position on the inbound webhook (invariant 1: nothing about
 * a registration ever stores where someone is). An ordinary SIM gateway
 * supplies no position at all; the SOS still goes ahead, carrying the
 * place in the sender's own words if they gave one, and trusted contacts
 * are told the location is unknown.
 */

const CATEGORY_BY_LETTER: Readonly<Record<string, SessionCategory>> = {
  M: 'medical',
  A: 'accident',
  O: 'other',
  S: 'personal_safety',
};

/** Fits inside one alert SMS alongside the rest of the message. */
const MAX_PLACE_NOTE = 140;

/** The free-text place after a command, tidied and capped. */
function placeFrom(words: string[]): string | undefined {
  const note = words.join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_PLACE_NOTE);
  return note.length > 0 ? note : undefined;
}

const HELP_TEXT =
  'Aegira commands: REG name contact-phone safe-pin duress-pin | SOS [place] | ' +
  'WATCH minutes | EXTEND minutes | CANCEL pin | STATUS | SAFE pin | ' +
  'SEND (contacts) | STOP';

const CANCELLED_REPLY = 'Aegira: session cancelled. Nobody was notified.';
const CHECKED_IN_REPLY = 'Aegira: checked in safe. Take care.';
const RESOLVED_REPLY = 'Aegira: marked safe. Session resolved. Take care.';
const WRONG_PIN_REPLY = 'Aegira: wrong PIN.';
const NO_SESSION_REPLY = 'Aegira: no active session.';

const STATUS_TEXT: Readonly<Record<SessionState, string>> = {
  WATCHING: 'Aegira: journey watch active. Text SAFE <pin> when you arrive, or EXTEND <min>.',
  PENDING: 'Aegira: SOS received, activating shortly. Text CANCEL <pin> to stop it.',
  ACTIVE: 'Aegira: your circle is alerted. Help is in motion.',
  DISPATCHED: 'Aegira: a verified responder is on the way.',
  ARRIVED: 'Aegira: your responder is with you.',
  RESOLVED: 'Aegira: session resolved. Stay safe.',
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
          return this.handleSos(from, parts.slice(1), approxLocation);
        case 'WATCH':
          return this.handleWatch(from, parts[1] ?? '', parts.slice(2), approxLocation);
        case 'EXTEND':
          return this.handleExtend(from, parts[1] ?? '');
        case 'CANCEL':
          return await this.handleCancel(from, parts[1] ?? '');
        case 'STATUS':
          return this.handleStatus(from);
        case 'SAFE':
          return await this.handleSafe(from, parts[1] ?? '');
        case 'SEND':
          return await this.handleSend(from);
        case 'STOP':
          return this.registrations.unregister(from)
            ? 'Aegira: registration deleted. Text REG to start again.'
            : HELP_TEXT;
        default:
          return HELP_TEXT;
      }
    } catch (error) {
      if (error instanceof InvalidInputError) {
        return `Aegira: ${error.message}.`;
      }
      throw error;
    }
  }

  private handleRegister(from: string, args: string[]): string {
    if (args.length < 4) {
      return 'Aegira: text REG <name> <contact-phone> <safe-pin> <duress-pin>. Use _ for spaces in the name.';
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
      `Aegira: registered as ${record.displayName} (consent ${record.consentVersion}). ` +
      'Text SOS to trigger help. Text STOP to delete this registration.'
    );
  }

  private handleSos(
    from: string,
    args: string[],
    approxLocation?: { lat: number; lng: number },
  ): string {
    const registration = this.registrations.find(from);
    if (registration === undefined) {
      return 'Aegira: not registered. Text REG <name> <contact-phone> <safe-pin> <duress-pin> first.';
    }
    // "SOS M near the bus stand": an optional one-letter category, then
    // the place in the sender's own words.
    const first = (args[0] ?? '').toUpperCase();
    const hasCategory = first.length === 1 && CATEGORY_BY_LETTER[first] !== undefined;
    const placeNote = placeFrom(hasCategory ? args.slice(1) : args);
    try {
      const receipt = this.sessions.trigger({
        userId: registration.phoneRef,
        displayName: registration.displayName,
        contacts: registration.contacts,
        ...(approxLocation === undefined ? {} : { location: approxLocation }),
        ...(placeNote === undefined ? {} : { placeNote }),
        category: hasCategory ? CATEGORY_BY_LETTER[first] : 'personal_safety',
        pinHashes: { safe: registration.pinSafeHash, duress: registration.pinDuressHash },
      });
      const seconds = Math.round(receipt.activationCountdownMs / 1000);
      const whereHint =
        approxLocation === undefined && placeNote === undefined
          ? ' Tell your circle where you are if you can.'
          : '';
      return (
        `Aegira: SOS received. Your circle will be alerted in ${seconds}s. ` +
        'Text CANCEL <pin> to stop it.' +
        whereHint
      );
    } catch (error) {
      if (error instanceof ActiveSessionExistsError) {
        return 'Aegira: you already have a session running. Text STATUS.';
      }
      throw error;
    }
  }

  private handleWatch(
    from: string,
    minutesStr: string,
    placeWords: string[],
    approxLocation?: { lat: number; lng: number },
  ): string {
    const registration = this.registrations.find(from);
    if (registration === undefined) {
      return 'Aegira: not registered. Text REG <name> <contact-phone> <safe-pin> <duress-pin> first.';
    }
    const placeNote = placeFrom(placeWords);
    const minutes = Number(minutesStr);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return 'Aegira: text WATCH <minutes>, e.g. WATCH 20 to be watched for 20 minutes.';
    }
    try {
      this.sessions.startWatch(
        {
          userId: registration.phoneRef,
          displayName: registration.displayName,
          contacts: registration.contacts,
          ...(approxLocation === undefined ? {} : { location: approxLocation }),
          ...(placeNote === undefined ? {} : { placeNote }),
          category: 'personal_safety',
          pinHashes: { safe: registration.pinSafeHash, duress: registration.pinDuressHash },
        },
        Math.round(minutes * 60 * 1000),
      );
      return (
        `Aegira: watching your journey for ${minutes} min. Text SAFE <pin> when you arrive, ` +
        `or EXTEND <min>. If you don't check in, your circle is alerted.`
      );
    } catch (error) {
      if (error instanceof ActiveSessionExistsError) {
        return 'Aegira: you already have a session running. Text STATUS.';
      }
      throw error;
    }
  }

  private handleExtend(from: string, minutesStr: string): string {
    const registration = this.registrations.find(from);
    const sessionId =
      registration === undefined
        ? null
        : this.sessions.latestSessionIdForUser(registration.phoneRef);
    if (sessionId === null) {
      return NO_SESSION_REPLY;
    }
    const minutes = Number(minutesStr);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return 'Aegira: text EXTEND <minutes>, e.g. EXTEND 10.';
    }
    try {
      this.sessions.extendWatch(sessionId, Math.round(minutes * 60 * 1000));
      return `Aegira: journey watch extended by ${minutes} min.`;
    } catch (error) {
      if (error instanceof WatchActionNotAllowedError) {
        return 'Aegira: no journey watch to extend.';
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
        return 'Aegira: this session is live and can no longer be cancelled.';
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

  private async handleSafe(from: string, pin: string): Promise<string> {
    const registration = this.registrations.find(from);
    const sessionId =
      registration === undefined
        ? null
        : this.sessions.latestSessionIdForUser(registration.phoneRef);
    if (sessionId === null) {
      return NO_SESSION_REPLY;
    }
    const state = this.sessions.opsView(sessionId).state;

    // On a journey watch, SAFE is the check-in: the safe PIN ends it, the
    // duress PIN escalates — and both get this identical reply (invariant 4).
    if (state === 'WATCHING') {
      try {
        await this.sessions.checkInSafe(sessionId, pin);
        return CHECKED_IN_REPLY;
      } catch (error) {
        if (error instanceof InvalidPinError) {
          return WRONG_PIN_REPLY;
        }
        throw error;
      }
    }

    // On a live emergency, SAFE resolves — safe PIN only. A duress PIN here
    // behaves exactly like any wrong PIN: deniability for a victim forced
    // to send "all clear". (Duress-resolve semantics are tracked in §9.)
    if (state === 'ACTIVE' || state === 'DISPATCHED' || state === 'ARRIVED') {
      if (this.registrations.verifyPin(from, pin) !== 'safe') {
        return WRONG_PIN_REPLY;
      }
      this.sessions.resolve(sessionId);
      return RESOLVED_REPLY;
    }
    return NO_SESSION_REPLY;
  }

  private async handleSend(from: string): Promise<string> {
    const address = normalizePhone(from);
    const sessionIds = this.sessions.dispatchableSessionIdsForContact(address);
    if (sessionIds.length === 0) {
      return 'Aegira: nothing to dispatch right now.';
    }
    let asked = 0;
    let unlocated = 0;
    for (const sessionId of sessionIds) {
      try {
        await this.sessions.dispatch(sessionId, this.roster());
        asked += 1;
      } catch (error) {
        if (!(error instanceof LocationUnknownError)) {
          throw error;
        }
        unlocated += 1;
      }
    }
    if (asked === 0 && unlocated > 0) {
      // Never claim help is coming when nobody could be sent.
      return "Aegira: we don't know where they are, so no helper can be sent. Call them, or call 112.";
    }
    return 'Aegira: verified responders have been asked to help.';
  }
}
