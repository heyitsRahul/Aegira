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
import { SmsOptInService } from './sms-optin.service';

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
 *   JOIN                                                 (contacts) agree to
 *                                                        receive alert SMS
 *   STOP                                                 delete registration
 *                                                        and any JOIN
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

// Plain words for people who may not read well; one example beats a syntax line.
const HELP_TEXT =
  'Aegira: First send REG your-name their-phone pin1 pin2 ' +
  '(example: REG Meera 9876543210 1234 9999). In danger, send SOS and where you are. ' +
  'Other words: CANCEL pin, STATUS, WATCH minutes, SAFE pin, STOP. Someone saved your number? Send JOIN.';

const CANCELLED_REPLY = 'Aegira: Cancelled. Nobody was told.';
const CHECKED_IN_REPLY = 'Aegira: Good, you reached safely. Take care.';
const RESOLVED_REPLY = 'Aegira: Good, you are safe. Take care.';
const WRONG_PIN_REPLY = 'Aegira: Wrong PIN. Try again.';
const NO_SESSION_REPLY = 'Aegira: Nothing is running right now.';

const STATUS_TEXT: Readonly<Record<SessionState, string>> = {
  WATCHING: 'Aegira: Timer is on. When you reach, send SAFE and your PIN. Need more time? Send EXTEND 15.',
  PENDING: 'Aegira: Sending help soon. To stop it, send CANCEL and your PIN.',
  ACTIVE: 'Aegira: Your people have been told. Help is coming.',
  DISPATCHED: 'Aegira: A trained helper is on the way.',
  ARRIVED: 'Aegira: Your helper is with you.',
  RESOLVED: 'Aegira: You are safe. Take care.',
  CANCELLED: NO_SESSION_REPLY,
  CLOSED: NO_SESSION_REPLY,
  PURGED: NO_SESSION_REPLY,
};

export class SmsGatewayService {
  constructor(
    private readonly sessions: SessionService,
    private readonly registrations: RegistrationService,
    private readonly roster: () => readonly ResponderProfile[],
    private readonly optIns: SmsOptInService | null = null,
    /** True when alerts only reach contacts who texted JOIN (public demo). */
    private readonly contactOptInRequired = false,
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
        case 'JOIN':
          return this.handleJoin(from);
        case 'STOP': {
          // STOP deletes everything this number gave us: its registration
          // (consent v4) and its alert opt-in (consent v6).
          const unregistered = this.registrations.unregister(from);
          const left = this.optIns?.leave(from) ?? false;
          return unregistered || left
            ? 'Aegira: Deleted. You will get no more messages from us. To come back, send JOIN or REG.'
            : HELP_TEXT;
        }
        default:
          return HELP_TEXT;
      }
    } catch (error) {
      if (error instanceof InvalidInputError) {
        return `Aegira: ${error.message.replace(/^invalid input: /, '')}.`;
      }
      throw error;
    }
  }

  private handleJoin(from: string): string {
    if (this.optIns === null) {
      return 'Aegira: Done. If someone saved this number, you will get a message when they need help.';
    }
    this.optIns.join(from);
    return (
      'Aegira: Done. If someone saved this number, we will send you a message when they ' +
      'need help. To stop, send STOP.'
    );
  }

  private handleRegister(from: string, args: string[]): string {
    if (args.length < 4) {
      return 'Aegira: Send REG your-name their-phone pin1 pin2. Example: REG Meera 9876543210 1234 9999';
    }
    const [name, contactPhone, pinSafe, pinDuress] = args;
    const record = this.registrations.register(
      from,
      name.replace(/_/g, ' '),
      contactPhone,
      pinSafe,
      pinDuress,
    );
    // If alerts need the contact's agreement, say so now, not after an SOS.
    const contactMustJoin =
      this.contactOptInRequired &&
      this.optIns !== null &&
      !this.optIns.hasJoined(record.contacts[0].address);
    return (
      `Aegira: Done, ${record.displayName}. In danger, send SOS. To delete your details, send STOP.` +
      (contactMustJoin
        ? ' IMPORTANT: ask your person to send JOIN to this number once, or they will not get your messages.'
        : '')
    );
  }

  private handleSos(
    from: string,
    args: string[],
    approxLocation?: { lat: number; lng: number },
  ): string {
    const registration = this.registrations.find(from);
    if (registration === undefined) {
      return 'Aegira: First send REG your-name their-phone pin1 pin2. Example: REG Meera 9876543210 1234 9999';
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
          ? ' If you can, send where you are.'
          : '';
      return (
        `Aegira: Got it. Your people will get a message in ${seconds} seconds. ` +
        'To stop it, send CANCEL and your PIN.' +
        whereHint
      );
    } catch (error) {
      if (error instanceof ActiveSessionExistsError) {
        return 'Aegira: Help is already running. Send STATUS to check.';
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
      return 'Aegira: First send REG your-name their-phone pin1 pin2. Example: REG Meera 9876543210 1234 9999';
    }
    const placeNote = placeFrom(placeWords);
    const minutes = Number(minutesStr);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return 'Aegira: Send WATCH and the minutes. Example: WATCH 20';
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
        `Aegira: Timer on for ${minutes} min. When you reach, send SAFE and your PIN. ` +
        `If you don't, your people get a message.`
      );
    } catch (error) {
      if (error instanceof ActiveSessionExistsError) {
        return 'Aegira: Help is already running. Send STATUS to check.';
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
      return 'Aegira: Send EXTEND and the minutes. Example: EXTEND 10';
    }
    try {
      this.sessions.extendWatch(sessionId, Math.round(minutes * 60 * 1000));
      return `Aegira: OK, ${minutes} more minutes.`;
    } catch (error) {
      if (error instanceof WatchActionNotAllowedError) {
        return 'Aegira: No timer is running.';
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
        return 'Aegira: Help has already been sent, so it cannot be cancelled now.';
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
      return 'Aegira: Nobody needs a helper right now.';
    }
    let asked = 0;
    let unlocated = 0;
    for (const sessionId of sessionIds) {
      try {
        const candidates = await this.sessions.dispatch(sessionId, this.roster());
        asked += candidates.length;
      } catch (error) {
        if (!(error instanceof LocationUnknownError)) {
          throw error;
        }
        unlocated += 1;
      }
    }
    // Never claim help is coming when nobody could be asked.
    if (asked === 0 && unlocated > 0) {
      return "Aegira: We don't know where they are, so no helper can go. Call them, or call 112.";
    }
    if (asked === 0) {
      return 'Aegira: No trained helper is near them right now. Call them, or call 112.';
    }
    return 'Aegira: We have asked trained helpers to go.';
  }
}
