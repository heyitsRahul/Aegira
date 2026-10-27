import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import {
  ActiveSessionExistsError,
  CancelNotAllowedError,
  InvalidInputError,
  InvalidPinError,
  LocationUnknownError,
} from '../domain/errors';
import { RegistrationService } from '../services/registration.service';
import { SessionService } from '../services/session.service';
import {
  applyDial,
  cancelledPage,
  contactViewPage,
  homePage,
  LITE_AREAS,
  messagePage,
  sosAcceptedPage,
  statusPage,
} from './lite-views';
import { ResponderRegistry } from './responder-registry';
import { RESPONDER_REGISTRY, SESSION_SERVICE } from './session.controller';

export const REGISTRATIONS = 'REGISTRATIONS';

/**
 * Where a lite session starts: a listed area if chosen, plus the place in
 * the user's own words. "Not listed" sends no coordinates at all rather
 * than a wrong guess — contacts are told the location is unknown.
 */
function startWhere(
  areaId: string | undefined,
  place: string | undefined,
): { location?: { lat: number; lng: number }; placeNote?: string } {
  const area = LITE_AREAS.find((a) => a.id === areaId);
  const note = (place ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
  return {
    ...(area === undefined ? {} : { location: { lat: area.lat, lng: area.lng } }),
    ...(note.length > 0 ? { placeNote: note } : {}),
  };
}

const STATE_TEXT: Record<string, string> = {
  WATCHING: 'Journey watch active. Mark safe when you arrive, or extend the time.',
  PENDING: 'SOS received - activating shortly. Cancel from the home page if accidental.',
  ACTIVE: 'Your circle is alerted. Help is in motion.',
  DISPATCHED: 'A verified responder is on the way.',
  ARRIVED: 'Your responder is with you.',
  RESOLVED: 'Session resolved. Stay safe.',
  CANCELLED: 'No active session.',
  CLOSED: 'No active session.',
  PURGED: 'No active session.',
};

/**
 * The zero-JavaScript channel: plain HTML forms for browsers that predate
 * fetch/Promise (Opera Mini, KaiOS, old stock Android). Same service, same
 * invariants — phone number + PIN is the credential, exactly like SMS, and
 * the cancel result page is one shared render for safe and duress.
 */
@Controller('lite')
export class LiteController {
  constructor(
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    @Inject(REGISTRATIONS) private readonly registrations: RegistrationService,
    @Inject(RESPONDER_REGISTRY) private readonly responders: ResponderRegistry,
  ) {}

  @Get()
  home(): string {
    return homePage();
  }

  @Post('register')
  register(
    @Body()
    body: {
      phone?: string;
      name?: string;
      contact?: string;
      pinSafe?: string;
      pinDuress?: string;
      dial?: string;
    },
  ): string {
    // Apply the chosen country dial code to nationally-typed numbers, so a
    // user anywhere can register without typing the +code themselves.
    try {
      const record = this.registrations.register(
        applyDial(body.phone ?? '', body.dial),
        body.name ?? '',
        applyDial(body.contact ?? '', body.dial),
        body.pinSafe ?? '',
        body.pinDuress ?? '',
      );
      return messagePage(
        'Registered',
        `Welcome ${record.displayName}. You can now send an SOS from the home page or by SMS.`,
      );
    } catch (error) {
      if (error instanceof InvalidInputError) {
        return messagePage('Could not register', error.message);
      }
      throw error;
    }
  }

  @Post('sos')
  sos(
    @Body() body: { phone?: string; area?: string; place?: string; category?: string; dial?: string },
  ): string {
    const registration = this.registrations.find(applyDial(body.phone ?? '', body.dial));
    if (registration === undefined) {
      return messagePage('Not registered', 'Register first from the home page.');
    }
    const where = startWhere(body.area, body.place);
    try {
      const receipt = this.sessions.trigger({
        userId: registration.phoneRef,
        displayName: registration.displayName,
        contacts: registration.contacts,
        ...where,
        category:
          body.category === 'medical' || body.category === 'accident' || body.category === 'other'
            ? body.category
            : 'personal_safety',
        pinHashes: { safe: registration.pinSafeHash, duress: registration.pinDuressHash },
      });
      return sosAcceptedPage(Math.round(receipt.activationCountdownMs / 1000));
    } catch (error) {
      if (error instanceof ActiveSessionExistsError) {
        return messagePage('Already running', 'You already have a session. Check STATUS.', true);
      }
      throw error;
    }
  }

  @Post('watch')
  watch(
    @Body() body: { phone?: string; area?: string; place?: string; minutes?: string; dial?: string },
  ): string {
    const registration = this.registrations.find(applyDial(body.phone ?? '', body.dial));
    if (registration === undefined) {
      return messagePage('Not registered', 'Register first from the home page.');
    }
    const where = startWhere(body.area, body.place);
    const minutes = Number(body.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return messagePage('Pick a time', 'Choose how many minutes to be watched for.');
    }
    try {
      this.sessions.startWatch(
        {
          userId: registration.phoneRef,
          displayName: registration.displayName,
          contacts: registration.contacts,
          ...where,
          category: 'personal_safety',
          pinHashes: { safe: registration.pinSafeHash, duress: registration.pinDuressHash },
        },
        Math.round(minutes * 60 * 1000),
      );
      return messagePage(
        'Watch started',
        `We are watching your journey for ${minutes} minutes. Use the STATUS form to mark ` +
          'yourself safe or extend the time. If you do not, your circle will be alerted.',
        true,
      );
    } catch (error) {
      if (error instanceof ActiveSessionExistsError) {
        return messagePage('Already running', 'You already have a session. Check STATUS.', true);
      }
      throw error;
    }
  }

  @Post('extend')
  extend(@Body() body: { phone?: string; pin?: string; minutes?: string; dial?: string }): string {
    const phone = applyDial(body.phone ?? '', body.dial);
    if (this.registrations.verifyPin(phone, body.pin ?? '') === 'invalid') {
      return messagePage('Wrong PIN', 'Wrong PIN.');
    }
    const registration = this.registrations.find(phone);
    const sessionId =
      registration === undefined
        ? null
        : this.sessions.latestSessionIdForUser(registration.phoneRef);
    const minutes = Number(body.minutes);
    if (sessionId === null || !Number.isFinite(minutes) || minutes <= 0) {
      return messagePage('Could not extend', 'No journey watch to extend.');
    }
    try {
      this.sessions.extendWatch(sessionId, Math.round(minutes * 60 * 1000));
      return messagePage('Extended', `Journey watch extended by ${minutes} minutes.`, true);
    } catch {
      return messagePage('Could not extend', 'No journey watch to extend.');
    }
  }

  @Post('cancel')
  async cancel(@Body() body: { phone?: string; pin?: string; dial?: string }): Promise<string> {
    const registration = this.registrations.find(applyDial(body.phone ?? '', body.dial));
    const sessionId =
      registration === undefined
        ? null
        : this.sessions.latestSessionIdForUser(registration.phoneRef);
    if (sessionId === null) {
      return messagePage('No session', 'No active session.');
    }
    try {
      await this.sessions.cancel(sessionId, body.pin ?? '');
      // One shared page for safe and duress cancels (invariant 4).
      return cancelledPage();
    } catch (error) {
      if (error instanceof InvalidPinError) {
        return messagePage('Wrong PIN', 'Wrong PIN.');
      }
      if (error instanceof CancelNotAllowedError) {
        return messagePage('Too late', 'This session is live and can no longer be cancelled.');
      }
      throw error;
    }
  }

  @Post('status')
  status(@Body() body: { phone?: string; pin?: string; dial?: string }): string {
    const phone = applyDial(body.phone ?? '', body.dial);
    if (this.registrations.verifyPin(phone, body.pin ?? '') === 'invalid') {
      return messagePage('Wrong PIN', 'Wrong PIN.');
    }
    const registration = this.registrations.find(phone);
    const sessionId =
      registration === undefined
        ? null
        : this.sessions.latestSessionIdForUser(registration.phoneRef);
    if (sessionId === null) {
      return statusPage('No active session.', false);
    }
    // Masked view: a duress session reads as cancelled/resolved here too.
    const state = this.sessions.clientStatus(sessionId).state;
    const live =
      state === 'WATCHING' ||
      state === 'ACTIVE' ||
      state === 'DISPATCHED' ||
      state === 'ARRIVED';
    return statusPage(STATE_TEXT[state] ?? state, live, state === 'WATCHING');
  }

  @Post('safe')
  async safe(@Body() body: { phone?: string; pin?: string; dial?: string }): Promise<string> {
    const phone = applyDial(body.phone ?? '', body.dial);
    const registration = this.registrations.find(phone);
    const sessionId =
      registration === undefined
        ? null
        : this.sessions.latestSessionIdForUser(registration.phoneRef);
    if (sessionId === null) {
      return messagePage('No session', 'No active session.');
    }
    const state = this.sessions.opsView(sessionId).state;
    // On a journey watch, "mark safe" is the check-in: safe PIN ends it,
    // duress PIN escalates, and both render this identical page (invariant 4).
    if (state === 'WATCHING') {
      try {
        await this.sessions.checkInSafe(sessionId, body.pin ?? '');
        return messagePage('Checked in safe', 'Glad you arrived. Take care.');
      } catch {
        return messagePage('Wrong PIN', 'Wrong PIN.');
      }
    }
    if (this.registrations.verifyPin(phone, body.pin ?? '') !== 'safe') {
      return messagePage('Wrong PIN', 'Wrong PIN.');
    }
    if (state !== 'ACTIVE' && state !== 'DISPATCHED' && state !== 'ARRIVED') {
      return messagePage('No session', 'No active session.');
    }
    this.sessions.resolve(sessionId);
    return messagePage('Marked safe', 'Session resolved. Take care.');
  }

  /** Contact live view — the link in alert SMS works on any browser. */
  @Get('c/:id')
  contact(@Param('id') id: string, @Query('t') token?: string): string {
    this.sessions.authorizeContact(id, token ?? null);
    const view = this.sessions.contactView(id);
    return contactViewPage({
      helpseekerDisplayName: view.helpseekerDisplayName || 'Session',
      state: view.state,
      duress: view.duress,
      category: view.category,
      location: view.location,
      placeNote: view.placeNote,
      canDispatch: view.state === 'ACTIVE' && view.location !== null,
      sessionId: id,
      token: token ?? '',
    });
  }

  @Post('c/:id/dispatch')
  async contactDispatch(@Param('id') id: string, @Query('t') token?: string): Promise<string> {
    this.sessions.authorizeSeekerOrContact(id, null, token ?? null);
    try {
      await this.sessions.dispatch(id, this.responders.all());
    } catch (error) {
      if (error instanceof LocationUnknownError) {
        return messagePage(
          'No location yet',
          "We don't know where they are, so no helper can be sent. Call them, or call 112.",
        );
      }
      throw error;
    }
    return messagePage('Dispatched', 'Verified responders have been asked to help.');
  }
}
