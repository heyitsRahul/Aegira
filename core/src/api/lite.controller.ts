import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import {
  ActiveSessionExistsError,
  CancelNotAllowedError,
  InvalidInputError,
  InvalidPinError,
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

const STATE_TEXT: Record<string, string> = {
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
  sos(@Body() body: { phone?: string; area?: string; category?: string; dial?: string }): string {
    const registration = this.registrations.find(applyDial(body.phone ?? '', body.dial));
    if (registration === undefined) {
      return messagePage('Not registered', 'Register first from the home page.');
    }
    const area = LITE_AREAS.find((a) => a.id === body.area) ?? LITE_AREAS[0];
    try {
      const receipt = this.sessions.trigger({
        userId: registration.phoneRef,
        displayName: registration.displayName,
        contacts: registration.contacts,
        location: { lat: area.lat, lng: area.lng },
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
    // Masked view: a duress session reads as cancelled here too.
    const state = this.sessions.clientStatus(sessionId).state;
    const live = state === 'ACTIVE' || state === 'DISPATCHED' || state === 'ARRIVED';
    return statusPage(STATE_TEXT[state] ?? state, live);
  }

  @Post('safe')
  safe(@Body() body: { phone?: string; pin?: string; dial?: string }): string {
    const phone = applyDial(body.phone ?? '', body.dial);
    if (this.registrations.verifyPin(phone, body.pin ?? '') !== 'safe') {
      return messagePage('Wrong PIN', 'Wrong PIN.');
    }
    const registration = this.registrations.find(phone);
    const sessionId =
      registration === undefined
        ? null
        : this.sessions.latestSessionIdForUser(registration.phoneRef);
    if (sessionId === null) {
      return messagePage('No session', 'No active session.');
    }
    const state = this.sessions.opsView(sessionId).state;
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
      canDispatch: view.state === 'ACTIVE',
      sessionId: id,
      token: token ?? '',
    });
  }

  @Post('c/:id/dispatch')
  async contactDispatch(@Param('id') id: string, @Query('t') token?: string): Promise<string> {
    this.sessions.authorizeSeekerOrContact(id, null, token ?? null);
    await this.sessions.dispatch(id, this.responders.all());
    return messagePage('Dispatched', 'Verified responders have been asked to help.');
  }
}
